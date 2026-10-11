import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import camelcaseKeys from "camelcase-keys";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { FREE_SET } from "./learned-test-fixtures";
import { WordbookReviewPage } from "./review-page";
import { CONFIG } from "./test-fixtures";

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

function setup(state: unknown, routes: Parameters<typeof createFetchMock>[0] = {}) {
  const mock = createFetchMock({
    ...TTS,
    "GET /api/wordbook/config": () => json(CONFIG),
    "POST /api/wordbook/answers": (call) => {
      const b = JSON.parse(String(call.body)) as { key: string; choice?: string; typed?: string };
      const ok = b.choice === b.key || b.typed === b.key;
      return json({ correct: ok, outcome: ok ? "correct" : "wrong", grade: ok ? "good" : "forgot", expected: b.key, correct_option: b.key, diff: null,
        item: { box: 2, due_at: "x" }, applied: !ok, rating: null, spot_check: false, check: null });
    },
    ...routes,
  });
  renderWithProviders(<WordbookReviewPage />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: { pathname: "/wordbook/review", search: "?source=free", state },
  });
  return mock;
}
const answers = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/wordbook/answers").map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);

beforeEach(() => { resetServerAiConfigCache(); localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("review page in free mode", () => {
  const state = { free: camelcaseKeys(FREE_SET, { deep: true }) };

  it("starts straight away, answers with mode free and each item's own book", async () => {
    const mock = setup(state);
    expect(await screen.findByTestId("choice-question")).toBeTruthy();
    expect(mock.calls.some((c) => c.url.pathname.endsWith("/review/batch") || c.url.pathname.endsWith("/today"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => expect(answers(mock)[0]).toMatchObject({ mode: "free", book_id: "cet4", key: "accept", qtype: "word", choice: "accept" }));
  });

  it("summarises without rank points, says it does not change the plan, and counts queued words", async () => {
    setup(state);
    await userEvent.click(await screen.findByRole("button", { name: "stop" }));            // 答错 → applied: true
    await userEvent.click(await screen.findByRole("button", { name: "继续" }));
    // 第二题是拼写(talk):键入并提交;答错的 accept 回到队尾,再答对一次
    await userEvent.type(await screen.findByRole("textbox"), "talk");
    await userEvent.click(screen.getByRole("button", { name: "提交" }));
    await userEvent.click(await screen.findByRole("button", { name: "继续" }));
    await userEvent.click(await screen.findByRole("button", { name: "accept" }));
    await userEvent.click(await screen.findByRole("button", { name: "继续" }));
    expect(await screen.findByTestId("session-summary")).toBeTruthy();
    expect(screen.getByTestId("summary-note")).toHaveTextContent("自由复习不计段位点,也不改变复习计划。 1 个答错的词已加入今天的复习。");
    expect(screen.queryByText("段位点")).toBeNull();
    expect(screen.getByRole("button", { name: "回到已学词" })).toBeTruthy();
  });

  it("goes back to the learned words when there is no batch in the router state", async () => {
    setup(null);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/learned"));
  });
});
