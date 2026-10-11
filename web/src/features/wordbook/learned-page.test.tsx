import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LEARNED_ITEMS, LEARNED_PAGE, LEARNED_SUMMARY } from "./learned-test-fixtures";
import { WordbookLearnedPage } from "./learned-page";
import { CONFIG, card } from "./test-fixtures";

vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play: vi.fn(), playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
}));

const TTS = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: [], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "", voice: "alloy" } } }),
};

function setup(routes: Parameters<typeof createFetchMock>[0] = {}) {
  const mock = createFetchMock({
    ...TTS,
    "GET /api/wordbook/config": () => json(CONFIG),
    "GET /api/wordbook/learned/summary": () => json(LEARNED_SUMMARY),
    "POST /api/wordbook/learned/query": () => json(LEARNED_PAGE),
    "POST /api/wordbook/learned/card": () => json(card("accept")),
    ...routes,
  });
  renderWithProviders(<WordbookLearnedPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/learned" });
  return mock;
}
const queries = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/wordbook/learned/query").map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);

beforeEach(() => { resetServerAiConfigCache(); localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("WordbookLearnedPage", () => {
  it("shows the distribution bar and the newest words first", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "已学词" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getAllByRole("button")[0]).toHaveTextContent("accept");
    expect(screen.getByRole("button", { name: "新学 3 词" })).toBeTruthy();
    expect(within(list).getAllByText("易错")).toHaveLength(1);   // 只有 accept 易错
    expect(within(list).getAllByText(/已到期/)).toHaveLength(1);  // carry 的到期日在过去
  });

  it("filters by tier when a segment is pressed and sends it in the body", async () => {
    const mock = setup();
    await screen.findByRole("list", { name: "已学词" });
    await userEvent.click(screen.getByRole("button", { name: "熟练 1 词" }));
    await waitFor(() => expect(queries(mock).at(-1)).toMatchObject({ tier: "mastered" }));
  });

  it("searches by prefix after the user stops typing, with no prefix in any URL", async () => {
    const mock = setup();
    await screen.findByRole("list", { name: "已学词" });
    await userEvent.type(screen.getByRole("searchbox", { name: "按英文前缀搜索" }), "ac");
    await waitFor(() => expect(queries(mock).at(-1)).toMatchObject({ q: "ac" }), { timeout: 2000 });
    expect(queries(mock).filter((b) => b.q === "a")).toHaveLength(0);   // 防抖:没有为中间状态发请求
    expect(mock.calls.every((c) => c.url.search === "" || c.url.pathname.endsWith("/summary") || c.url.pathname.startsWith("/api/config"))).toBe(true);
  });

  it("filters weak words and clears every filter", async () => {
    const mock = setup();
    await screen.findByRole("list", { name: "已学词" });
    await userEvent.click(screen.getByRole("button", { name: "易错" }));
    await waitFor(() => expect(queries(mock).at(-1)).toMatchObject({ weak: true }));
    await userEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    await waitFor(() => expect(queries(mock).at(-1)).not.toHaveProperty("weak"));
  });

  it("loads more with the cursor", async () => {
    const pages = [{ items: LEARNED_ITEMS.slice(0, 2), next_cursor: "c1" }, { items: LEARNED_ITEMS.slice(2), next_cursor: null }];
    const mock = setup({ "POST /api/wordbook/learned/query": () => json(pages.shift()) });
    await screen.findByRole("list", { name: "已学词" });
    await userEvent.click(await screen.findByRole("button", { name: "加载更多" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(queries(mock)[1]).toMatchObject({ cursor: "c1" });
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
  });

  it("opens the word card in a sheet through the POST lookup", async () => {
    const mock = setup();
    await userEvent.click((await screen.findAllByRole("button", { name: /accept/ }))[0]);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/learned/card")).toBe(true));
    expect(JSON.parse(String(mock.calls.find((c) => c.url.pathname.endsWith("/learned/card"))?.body))).toEqual({ book_id: "cet4", key: "accept" });
    expect(await screen.findByText("accept 的释义")).toBeTruthy();
  });

  it("explains an empty library and links to learning", async () => {
    setup({
      "GET /api/wordbook/learned/summary": () => json({ ...LEARNED_SUMMARY, total: 0, by_tier: { learning: 0, growing: 0, mastered: 0 }, by_book: [] }),
      "POST /api/wordbook/learned/query": () => json({ items: [], next_cursor: null }),
    });
    expect(await screen.findByText("还没有已学的词")).toBeTruthy();
    expect(screen.getByRole("link", { name: "去学新词" })).toHaveAttribute("href", "/wordbook/learn");
  });

  it("tells the difference between an empty filter result and an empty library", async () => {
    setup({ "POST /api/wordbook/learned/query": () => json({ items: [], next_cursor: null }) });
    await userEvent.click(await screen.findByRole("button", { name: "易错" }));
    expect(await screen.findByText("没有符合条件的词")).toBeTruthy();
  });

  it("shows a translated error with a retry", async () => {
    setup({ "POST /api/wordbook/learned/query": () => json({ error: "Invalid cursor" }, 422) });
    expect(await screen.findByText("列表已过期,请刷新")).toBeTruthy();
  });
});
