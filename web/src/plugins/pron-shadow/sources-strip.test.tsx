import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { Slot } from "~/lib/extension-points-react";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import "./index";

const flags = (on: boolean): LinkFlags =>
  ({ enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, on && k === "pron_shadow"])) as LinkFlags["links"] });
const ON = flags(true);
const api = (mock: ReturnType<typeof createFetchMock>) => new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });

beforeEach(async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
  setLinkFlags(ON);
});
afterEach(async () => {
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

it("shows weak-word and today-word chips; picking a today word fills the reference", async () => {
  const mock = createFetchMock({
    "GET /api/links/weak-words": () => json({ items: [{ word: "three", hits: 3, last_score: 52, last_weak_at: "2026-10-11T08:00:00+00:00", example: null }], total: 6 }),
    "GET /api/links/today-words": () => json({ items: [
      { key: "brew", word: "brew", example: { en: "She brewed a pot of tea.", zh: "她泡了一壶茶。" } },
      { key: "zest", word: "zest", example: null },
    ] }),
  });
  const pick = vi.fn();
  renderWithProviders(<Slot point="learningSources" props={{ pick }} />, { api: api(mock) });
  expect(await screen.findByRole("link", { name: /发音弱词 6/ })).toHaveAttribute("href", "/links/weak-words");
  fireEvent.click(await screen.findByRole("button", { name: /今日新词 2/ }));
  expect(await screen.findByText("今日新词例句")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /zest/ })).toBeDisabled();
  expect(screen.getByText("这个词没有例句")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /She brewed a pot of tea\./ }));
  expect(pick).toHaveBeenCalledWith("She brewed a pot of tea.");
  await waitFor(() => expect(screen.queryByText("今日新词例句")).toBeNull());
  const today = mock.calls.find((c) => c.url.pathname === "/api/links/today-words")!;
  expect(today.url.searchParams.get("offset")).toBe(String(-new Date().getTimezoneOffset()));
});

it("hides chips that have nothing to offer", async () => {
  const mock = createFetchMock({
    "GET /api/links/weak-words": () => json({ items: [], total: 0 }),
    "GET /api/links/today-words": () => json({ items: [] }),
  });
  const { container } = renderWithProviders(<Slot point="learningSources" props={{ pick: vi.fn() }} />, { api: api(mock) });
  await waitFor(() => expect(mock.calls).toHaveLength(2));
  await new Promise((r) => setTimeout(r, 0));
  expect(container.querySelector("[data-testid^=source-chip]")).toBeNull();
});

it("hides chips when the requests fail", async () => {
  const mock = createFetchMock({});
  const { container } = renderWithProviders(<Slot point="learningSources" props={{ pick: vi.fn() }} />, { api: api(mock) });
  await waitFor(() => expect(mock.calls).toHaveLength(2));
  await new Promise((r) => setTimeout(r, 0));
  expect(container.querySelector("[data-testid^=source-chip]")).toBeNull();
});

it.each([["all links off", ALL_OFF], ["this link off", flags(false)]])("renders nothing and asks nothing with %s", async (_, f) => {
  setLinkFlags(f);
  const mock = createFetchMock({});
  const { container } = renderWithProviders(<Slot point="learningSources" props={{ pick: vi.fn() }} />, { api: api(mock) });
  await new Promise((r) => setTimeout(r, 0));
  expect(container.innerHTML).toBe(renderWithProviders(<></>).container.innerHTML);
  expect(mock.calls).toHaveLength(0);
});
