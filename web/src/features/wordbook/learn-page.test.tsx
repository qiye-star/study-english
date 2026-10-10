import { screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import i18n from "~/i18n";
import { createFetchMock, json, type RecordedCall } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookLearnPage } from "./learn-page";
import { CONFIG, card } from "./test-fixtures";

const play = vi.fn();
const prime = vi.fn();
vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play, playQueue: vi.fn(), stop: vi.fn(), prime }),
}));

const TTS_ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

const BATCH: Record<string, unknown> & { cards: unknown[]; quiz: unknown[] } = {
  book_id: "cet4",
  cards: [card("talk", { us: "tɔk", uk: "tɔːk", senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }],
    examples: [{ id: "s1", en: "I could hear Sarah and Andy talking in the next room.", zh: "我听到萨拉和安迪在隔壁讲话。" }] }),
  card("accept", { senses: [{ pos: "vt", text: "接受；承认" }] })],
  quiz: [
    { key: "talk", qtype: "meaning", prompt: { word: "talk", us: "tɔk" }, options: ["v. 放弃；抛弃", "v. 说话；谈话；n. 交谈", "v. 携带；搬运", "v. 吸收；使专心"], length: null },
    { key: "accept", qtype: "meaning", prompt: { word: "accept", us: "us-accept" }, options: ["vt. 接受；承认", "v. 携带；搬运", "n. 能力", "v. 停止"], length: null },
  ],
};

const CORRECT: Record<string, string> = { talk: "v. 说话；谈话；n. 交谈", accept: "vt. 接受；承认" };

function answerRoute(call: RecordedCall) {
  const body = JSON.parse(String(call.body)) as { key: string; choice?: string; known?: boolean };
  if (body.known) return json({ correct: true, outcome: "known", grade: "good", expected: body.key, correct_option: null, diff: null, item: { box: 2, due_at: "x" }, applied: true });
  const ok = body.choice === CORRECT[body.key];
  return json({ correct: ok, outcome: ok ? "correct" : "wrong", grade: ok ? "good" : "forgot", expected: body.key, correct_option: CORRECT[body.key] ?? null, diff: null, item: { box: 0, due_at: "x" }, applied: true });
}

function setup(routes: Parameters<typeof createFetchMock>[0] = {}) {
  const mock = createFetchMock({
    ...TTS_ROUTES,
    "GET /api/wordbook/config": () => json(CONFIG),
    "POST /api/wordbook/learn/batch": () => json(BATCH),
    "POST /api/wordbook/answers": answerRoute,
    ...routes,
  });
  renderWithProviders(<WordbookLearnPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/learn" });
  return mock;
}

const answers = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/wordbook/answers").map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);

beforeEach(() => {
  resetServerAiConfigCache();
  play.mockReset();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("WordbookLearnPage", () => {
  it("walks through the cards, quizzes them, requeues a miss and summarises", async () => {
    const user = userEvent.setup();
    const mock = setup();
    const first = await screen.findByTestId("word-card");
    expect(within(first).getByRole("heading", { name: "talk" })).toBeTruthy();
    expect(first).toHaveTextContent("tɔk");
    expect(first).toHaveTextContent("说话；谈话");
    expect(first.querySelector("mark")?.textContent).toBe("talking");
    await user.click(screen.getByRole("button", { name: "下一个" }));
    expect(within(screen.getByTestId("word-card")).getByRole("heading", { name: "accept" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "开始小测" }));

    // 第 1 题:答对
    expect(await screen.findByText("选择正确的释义")).toBeTruthy();
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("");
    await user.click(screen.getByRole("button", { name: /说话；谈话；n\. 交谈/ }));
    await waitFor(() => expect(live).toHaveTextContent("答对了"));
    expect(answers(mock)[0]).toMatchObject({ book_id: "cet4", mode: "learn", qtype: "meaning", key: "talk", choice: CORRECT.talk });
    expect(screen.getByRole("button", { name: /说话；谈话；n\. 交谈/ })).toHaveAttribute("data-state", "correct");
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(live.textContent).toBe("");

    // 第 2 题:答错 → 正确项标出、显示词卡摘要 → 回到队尾再测
    await user.click(await screen.findByRole("button", { name: /携带；搬运/ }));
    await waitFor(() => expect(live).toHaveTextContent("正确答案是 vt. 接受；承认"));
    expect(screen.getByRole("button", { name: /携带；搬运/ })).toHaveAttribute("data-state", "wrong");
    expect(screen.getByRole("button", { name: /接受；承认/ })).toHaveAttribute("data-state", "correct");
    expect(screen.getByTestId("word-recap")).toHaveTextContent("accept");
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(await screen.findByText("accept", { selector: "[data-testid=question-word]" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /接受；承认/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));

    const summary = await screen.findByTestId("session-summary");
    expect(summary).toHaveTextContent("学会 2 个新词");
    expect(summary).toHaveTextContent("一次答对 1");
    expect(answers(mock)).toHaveLength(3);
  }, 15_000); // ~0.7 s normally; one long userEvent flow hit the 5 s default twice in full runs on a loaded machine

  it("marks a known word without quizzing it", async () => {
    const user = userEvent.setup();
    const mock = setup();
    await screen.findByTestId("word-card");
    await user.click(screen.getByRole("button", { name: "我认识" }));
    await waitFor(() => expect(answers(mock)[0]).toMatchObject({ key: "talk", mode: "learn", qtype: "meaning", known: true }));
    expect(within(await screen.findByTestId("word-card")).getByRole("heading", { name: "accept" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "开始小测" }));
    expect(await screen.findByText("accept", { selector: "[data-testid=question-word]" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /接受；承认/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    const summary = await screen.findByTestId("session-summary");
    // 「我认识」算一次答对:2 个词,1 个认识 + 1 个一次答对 → 100%
    expect(within(summary).getByRole("status").textContent).toBe("学会 2 个新词 · 一次答对 2");
    expect(summary).toHaveTextContent("100%");
    expect(answers(mock).filter((a) => a.key === "talk")).toHaveLength(1);
  });

  it("a round where every word is known is not a 0% summary", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByTestId("word-card");
    await user.click(screen.getByRole("button", { name: "我认识" }));
    expect(within(await screen.findByTestId("word-card")).getByRole("heading", { name: "accept" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "我认识" }));
    const summary = await screen.findByTestId("session-summary");
    expect(within(summary).getByRole("status").textContent).toBe("学会 2 个新词 · 一次答对 2");
    expect(summary).toHaveTextContent("100%");
  });

  it("reads the word aloud with the default voice", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByTestId("word-card");
    const listen = await screen.findByRole("button", { name: "朗读美音" });
    await waitFor(() => expect(listen).toBeEnabled());
    await user.click(listen);
    expect(play).toHaveBeenCalledWith(expect.any(String), "talk", "openai/tts-1", "alloy");
  });

  it("still shows answer results under StrictMode (double-mounted effects)", async () => {
    const user = userEvent.setup();
    const mock = createFetchMock({ ...TTS_ROUTES, "GET /api/wordbook/config": () => json(CONFIG), "POST /api/wordbook/learn/batch": () => json(BATCH), "POST /api/wordbook/answers": answerRoute });
    renderWithProviders(<StrictMode><WordbookLearnPage /></StrictMode>, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/learn" });
    await screen.findByTestId("word-card");
    await user.click(screen.getByRole("button", { name: "我认识" }));
    expect(within(await screen.findByTestId("word-card")).getByRole("heading", { name: "accept" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "开始小测" }));
    await user.click(await screen.findByRole("button", { name: /接受；承认/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("答对了"));
  });

  it("says when today's new words are done", async () => {
    setup({ "POST /api/wordbook/learn/batch": () => json({ book_id: "cet4", cards: [], quiz: [] }) });
    expect(await screen.findByText("今天的新词学完了")).toBeTruthy();
    expect(screen.getByRole("link", { name: "回到首页" })).toHaveAttribute("href", "/wordbook");
  });

  it("shows a translated error when there is no active book", async () => {
    setup({ "POST /api/wordbook/learn/batch": () => json({ error: "No active book" }, 409) });
    expect(await screen.findByText("先选一本词书")).toBeTruthy();
  });
});
