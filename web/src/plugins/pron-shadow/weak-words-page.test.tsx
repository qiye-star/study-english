import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { Slot } from "~/lib/extension-points-react";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WithShadowSheet } from "~/features/practice/shadow/test-utils";
import { WeakWordsPage } from "./weak-words-page";
import "./index";

const ON: LinkFlags = { enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k === "pron_shadow"])) as LinkFlags["links"] };
const at = "2026-10-11T08:00:00+00:00";
const row = (word: string, hits: number, score: number | null, example: string | null = null) =>
  ({ word, hits, last_score: score, last_weak_at: at, example });
const ITEMS = [row("three", 3, 52, "Three trees."), row("world", 2, 78), row("rural", 2, 90), row("thought", 1, null),
  row("squirrel", 1, 40), row("sixth", 1, 41)];

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

const api = (mock: ReturnType<typeof createFetchMock>) => new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
const state = () => JSON.parse(screen.getByTestId("location").dataset.state ?? "null");
const listing = () => createFetchMock({ "GET /api/links/weak-words": () => json({ items: ITEMS, total: 6 }) });

it("lists weak words with score tones and hit counts", async () => {
  renderWithProviders(<WeakWordsPage />, { api: api(listing()) });
  const three = await screen.findByTestId("weak-three");
  expect(three).toHaveTextContent("最近 52 分 · 出现 3 次");
  expect(within(three).getByText("最近 52 分")).toHaveClass("text-ink-2");
  expect(within(screen.getByTestId("weak-world")).getByText("最近 78 分")).toHaveClass("text-amber");
  expect(within(screen.getByTestId("weak-rural")).getByText("最近 90 分")).toHaveClass("text-green");
  expect(screen.getByTestId("weak-thought")).toHaveTextContent("未评分 · 出现 1 次");
  expect(screen.getByText("跟读里读得不准的词。读准两次后自动移出。")).toBeInTheDocument();
});

it("shadow uses the example sentence and opens the shadow sheet without navigating", async () => {
  renderWithProviders(<WithShadowSheet><WeakWordsPage /></WithShadowSheet>, { api: api(listing()) });
  fireEvent.click(within(await screen.findByTestId("weak-three")).getByRole("button", { name: "跟读:three" }));
  expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
  expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Three trees.");
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  expect(state()).toBeNull();
});

it("shadowing a word without an example uses the word", async () => {
  renderWithProviders(<WithShadowSheet><WeakWordsPage /></WithShadowSheet>, { api: api(listing()) });
  fireEvent.click(within(await screen.findByTestId("weak-world")).getByRole("button", { name: "跟读:world" }));
  expect(await screen.findByTestId("shadow-reference")).toHaveTextContent("world");
});

it("drills the top five words together in the shadow sheet", async () => {
  renderWithProviders(<WithShadowSheet><WeakWordsPage /></WithShadowSheet>, { api: api(listing()) });
  fireEvent.click(await screen.findByRole("button", { name: "连读这 5 个" }));
  expect(await screen.findByTestId("shadow-reference")).toHaveTextContent("three, world, rural, thought, squirrel");
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
});

it("dismisses a word and shows the empty state", async () => {
  let items = [ITEMS[0], ITEMS[1]];
  const mock = createFetchMock({
    "GET /api/links/weak-words": () => json({ items, total: items.length }),
    "POST /api/links/weak-words/dismiss": (c) => {
      const { word } = JSON.parse(String(c.body));
      items = items.filter((i) => i.word !== word);
      return json({ word });
    },
  });
  renderWithProviders(<WeakWordsPage />, { api: api(mock) });
  fireEvent.click(within(await screen.findByTestId("weak-three")).getByRole("button", { name: "移出:three" }));
  await waitFor(() => expect(screen.queryByTestId("weak-three")).toBeNull());
  expect(screen.getByRole("button", { name: "连读这 1 个" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByTestId("weak-world")).getByRole("button", { name: "移出:world" }));
  expect(await screen.findByText("暂时没有发音弱词。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /连读/ })).toBeNull();
  expect(mock.calls.filter((c) => c.method === "POST").map((c) => JSON.parse(String(c.body)))).toEqual([{ word: "three" }, { word: "world" }]);
});

it("puts the word back when dismissing fails", async () => {
  const mock = createFetchMock({
    "GET /api/links/weak-words": () => json({ items: [ITEMS[0]], total: 1 }),
    "POST /api/links/weak-words/dismiss": () => json({ error: "Link is off" }, 404),
  });
  renderWithProviders(<WeakWordsPage />, { api: api(mock) });
  fireEvent.click(within(await screen.findByTestId("weak-three")).getByRole("button", { name: "移出:three" }));
  await waitFor(() => expect(mock.calls.some((c) => c.method === "POST")).toBe(true));
  expect(await screen.findByTestId("weak-three")).toBeInTheDocument();
});

it("notebook row shows the count and links to the page", async () => {
  renderWithProviders(<Slot point="notebookViews" props={{}} />, { api: api(listing()) });
  const link = await screen.findByRole("link", { name: /发音弱词/ });
  expect(link).toHaveAttribute("href", "/links/weak-words");
  await waitFor(() => expect(link).toHaveTextContent("6"));
});

it("notebook row is absent when the link is off", async () => {
  setLinkFlags(ALL_OFF);
  const mock = createFetchMock({});
  const { container } = renderWithProviders(<Slot point="notebookViews" props={{}} />, { api: api(mock) });
  await new Promise((r) => setTimeout(r, 0));
  expect(container.querySelector("[data-testid=notebook-weak-words]")).toBeNull();
  expect(mock.calls).toHaveLength(0);
});

it("liquid: last score in ink with a dot (plan 2026-10-15-liquid-glass L10)", async () => {
  renderWithProviders(<WeakWordsPage />, { api: api(listing()) });
  const rural = await screen.findByTestId("weak-rural");
  const score = within(rural).getByText("最近 90 分");
  expect(score.className).toContain("liquid:text-ink");
  expect(score.querySelector("[data-score-dot]")!.className).toContain("bg-green");
  expect(within(screen.getByTestId("weak-three")).getByText("最近 52 分").querySelector("[data-score-dot]")).toBeNull();
});
