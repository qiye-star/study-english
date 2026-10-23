import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { ShadowPage } from "~/features/practice";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import "./index";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

const ON: LinkFlags = { enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k === "pron_shadow"])) as LinkFlags["links"] };
const ROUTES = {
  "GET /api/links/weak-words": () => json({ items: [], total: 4 }),
  "GET /api/links/today-words": () => json({ items: [{ key: "brew", word: "brew", example: { en: "She brewed a pot of tea.", zh: "她泡了一壶茶。" } }] }),
};
const render = (mock: ReturnType<typeof createFetchMock>) =>
  renderWithProviders(<ShadowPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice/shadow" });

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
});
afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

it("picking a today word's example fills the shadowing reference text", async () => {
  setLinkFlags(ON);
  render(createFetchMock(ROUTES));
  expect(await screen.findByTestId("source-chip-weak")).toHaveTextContent("发音弱词 4");
  fireEvent.click(await screen.findByTestId("source-chip-today"));
  fireEvent.click(await screen.findByRole("button", { name: /She brewed a pot of tea\./ }));
  await waitFor(() => expect(screen.getByTestId("reference-input")).toHaveValue("She brewed a pot of tea."));
});

it("with the link off the shadowing area is unchanged and nothing is requested", async () => {
  const mock = createFetchMock(ROUTES);
  render(mock);
  await screen.findByTestId("reference-input");
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByTestId("source-chip-weak")).toBeNull();
  expect(screen.queryByTestId("source-chip-today")).toBeNull();
  expect(mock.calls.some((c) => c.url.pathname.startsWith("/api/links/"))).toBe(false);
});
