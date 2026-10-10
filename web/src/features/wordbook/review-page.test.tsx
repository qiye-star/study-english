import { screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import i18n from "~/i18n";
import { createFetchMock, json, type RecordedCall } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookReviewPage } from "./review-page";
import { CONFIG, ENROLLED_TODAY, PLAN, card } from "./test-fixtures";

const play = vi.fn();
const prime = vi.fn();
vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play, playQueue: vi.fn(), stop: vi.fn(), prime }),
}));

const TTS = (models: string[]) => ({
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models, voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: models[0] ?? "", voice: "alloy" } } }),
});

const BATCH: { book_id: string; questions: unknown[]; cards: Record<string, ReturnType<typeof card>> } = {
  book_id: "cet4",
  questions: [
    { key: "accept", qtype: "meaning", prompt: { word: "accept", us: "əkˈsɛpt" }, options: ["v. 放弃；抛弃", "vt. 接受；承认", "v. 携带；搬运", "v. 停止"], length: null },
    { key: "carry", qtype: "cloze", prompt: { sentence: "He _____ the heavy box up the stairs.", zh: "他把那个重箱子搬上了楼。" }, options: ["stop", "carry", "go", "child"], length: null },
    { key: "talk", qtype: "spell", prompt: { meaning: "v. 说话；谈话", us: "tɔk" }, options: null, length: 4 },
  ],
  cards: {
    accept: card("accept", { senses: [{ pos: "vt", text: "接受；承认" }] }),
    carry: card("carry", { senses: [{ pos: "vt", text: "携带；搬运" }] }),
    talk: card("talk", { senses: [{ pos: "v", text: "说话；谈话" }] }),
  },
};

const CORRECT: Record<string, string> = { accept: "vt. 接受；承认", carry: "carry" };

function answerRoute(call: RecordedCall) {
  const body = JSON.parse(String(call.body)) as { key: string; choice?: string; typed?: string; qtype: string };
  if (body.typed !== undefined) {
    if (body.typed === "talk") return json({ correct: true, outcome: "correct", grade: "good", expected: "talk", correct_option: null, diff: null, item: { box: 4, due_at: "x" }, applied: false });
    return json({ correct: false, outcome: "typo", grade: "hard", expected: "talk", correct_option: null, applied: true, item: { box: 3, due_at: "x" },
      diff: [{ op: "eq", a: "t", b: "t" }, { op: "eq", a: "a", b: "a" }, { op: "eq", a: "l", b: "l" }, { op: "eq", a: "k", b: "k" }, { op: "ins", a: "", b: "k" }] });
  }
  const ok = body.choice === CORRECT[body.key];
  return json({ correct: ok, outcome: ok ? "correct" : "wrong", grade: ok ? "good" : "forgot", expected: body.key, correct_option: CORRECT[body.key] ?? null, diff: null,
    item: { box: body.key === "accept" ? 4 : 2, due_at: "x" }, applied: true });
}

function setup(routes: Parameters<typeof createFetchMock>[0] = {}, models = ["openai/tts-1"]) {
  const mock = createFetchMock({
    ...TTS(models),
    "GET /api/wordbook/config": () => json(CONFIG),
    "GET /api/wordbook/today": () => json({ ...ENROLLED_TODAY, plan: { ...PLAN, review_due: 3, review_left: 3 } }),
    "POST /api/wordbook/review/batch": () => json(BATCH),
    "POST /api/wordbook/answers": answerRoute,
    ...routes,
  });
  renderWithProviders(<WordbookReviewPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/review" });
  return mock;
}

const answers = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/wordbook/answers").map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);

beforeEach(() => {
  resetServerAiConfigCache();
  play.mockReset();
  prime.mockReset();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("WordbookReviewPage", () => {
  it("runs a mixed review, requeues a near miss and summarises", async () => {
    const user = userEvent.setup();
    const mock = setup();
    await user.click(await screen.findByRole("button", { name: "开始复习 3" }));
    expect(prime).toHaveBeenCalled();

    // meaning
    await user.click(await screen.findByRole("button", { name: /vt\. 接受；承认/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("答对了"));
    expect(answers(mock)[0]).toMatchObject({ book_id: "cet4", mode: "review", qtype: "meaning", key: "accept", choice: "vt. 接受；承认" });
    await user.click(screen.getByRole("button", { name: "继续" }));

    // cloze
    expect(await screen.findByText("例句选词")).toBeTruthy();
    expect(screen.getByText("他把那个重箱子搬上了楼。")).toBeTruthy();
    expect(screen.getByText("_____")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /carry/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /carry/ })).toHaveAttribute("data-state", "correct"));
    await user.click(screen.getByRole("button", { name: "继续" }));

    // spell: near miss
    const input = await screen.findByRole("textbox");
    await user.type(input, "talkk{Enter}");
    expect(await screen.findByTestId("outcome-badge")).toHaveTextContent("小笔误");
    expect(screen.getByRole("img", { name: "正确拼写 talk" })).toBeTruthy();
    expect(answers(mock)[2]).toMatchObject({ mode: "review", qtype: "spell", key: "talk", typed: "talkk", hinted: false });
    await user.click(screen.getByRole("button", { name: "继续" }));

    // 回到队尾再出一次
    const again = await screen.findByRole("textbox");
    expect(again).toHaveValue("");
    await user.type(again, "talk{Enter}");
    await user.click(await screen.findByRole("button", { name: "继续" }));

    const summary = await screen.findByTestId("session-summary");
    expect(summary).toHaveTextContent("复习 3");
    expect(summary).toHaveTextContent("一次答对 2");
    expect(summary).toHaveTextContent("1 个词进入「已掌握」");
    expect(summary).toHaveTextContent("talk");
  });

  it("shows achievements this session unlocked in the summary (spec §11.2, mockup frame 10)", async () => {
    const user = userEvent.setup();
    const mock = setup({
      "POST /api/wordbook/review/batch": () => json({ ...BATCH, questions: [BATCH.questions[0]] }),
      "GET /api/rank/config": () => json({ enabled: true, match_available: false, tiers: [], season: null }),
      "GET /api/rank/me": () => json({ new_achievements: ["words_mastered_100"] }),
      "GET /api/rank/achievements": () => json({ achievements: [
        { key: "words_mastered_100", group: "vocab", icon: "book", unlocked_at: "2026-10-10T08:00:00+00:00" },
        { key: "streak_3", group: "streak", icon: "flame", unlocked_at: null },
      ] }),
    });
    await user.click(await screen.findByRole("button", { name: "开始复习 3" }));
    await user.click(await screen.findByRole("button", { name: /vt\. 接受；承认/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    const summary = await screen.findByTestId("session-summary");
    const group = await within(summary).findByTestId("new-achievements");
    expect(group).toHaveTextContent("新解锁");
    expect(group).toHaveTextContent("小有积累");
    expect(group).toHaveTextContent("掌握 100 个单词");
    expect(group).not.toHaveTextContent("三日不辍");
    expect(mock.calls.filter((c) => c.url.pathname === "/api/rank/me")).toHaveLength(1);
  });

  it("does not ask for achievements when rank is off", async () => {
    const user = userEvent.setup();
    const mock = setup({
      "POST /api/wordbook/review/batch": () => json({ ...BATCH, questions: [BATCH.questions[0]] }),
      "GET /api/rank/config": () => json({ enabled: false, match_available: false, tiers: [], season: null }),
    });
    await user.click(await screen.findByRole("button", { name: "开始复习 3" }));
    await user.click(await screen.findByRole("button", { name: /vt\. 接受；承认/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    await screen.findByTestId("session-summary");
    expect(screen.queryByTestId("new-achievements")).toBeNull();
    expect(mock.calls.some((c) => c.url.pathname === "/api/rank/me")).toBe(false);
  });

  it("still shows answer results under StrictMode (double-mounted effects)", async () => {
    const user = userEvent.setup();
    const mock = createFetchMock({
      ...TTS(["openai/tts-1"]), "GET /api/wordbook/config": () => json(CONFIG), "GET /api/wordbook/today": () => json(ENROLLED_TODAY),
      "POST /api/wordbook/review/batch": () => json(BATCH), "POST /api/wordbook/answers": answerRoute,
    });
    renderWithProviders(<StrictMode><WordbookReviewPage /></StrictMode>, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/review" });
    const start = await screen.findByRole("button", { name: /开始复习/ });
    await waitFor(() => expect(start).toBeEnabled());
    await user.click(start);
    await user.click(await screen.findByRole("button", { name: /vt\. 接受；承认/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("答对了"));
  });

  it("says when nothing is due and links to new words", async () => {
    setup({
      "GET /api/wordbook/today": () => json({ ...ENROLLED_TODAY, plan: { ...PLAN, review_due: 0, review_left: 0 } }),
      "POST /api/wordbook/review/batch": () => json({ book_id: "cet4", questions: [], cards: {} }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "开始复习" }));
    expect(await screen.findByText("今天没有要复习的词")).toBeTruthy();
    expect(screen.getByRole("link", { name: "学新词" })).toHaveAttribute("href", "/wordbook/learn");
  });

  it("turns dictation into spelling when read-aloud is not configured", async () => {
    const mock = setup({
      "POST /api/wordbook/review/batch": () => json({ book_id: "cet4", questions: [
        { key: "talk", qtype: "dictation", prompt: { word: "talk" }, options: null, length: 4 }], cards: { talk: BATCH.cards.talk } }),
    }, []);
    const start = await screen.findByRole("button", { name: /开始复习/ });
    await waitFor(() => expect(start).toBeEnabled());
    await userEvent.click(start);
    expect(await screen.findByText("看释义拼写")).toBeTruthy();
    expect(screen.getByText("v. 说话；谈话")).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox"), "talk{Enter}");
    await waitFor(() => expect(answers(mock)[0]).toMatchObject({ key: "talk", qtype: "spell", typed: "talk" }));
  });

  it("plays dictation automatically once the review starts", async () => {
    setup({
      "POST /api/wordbook/review/batch": () => json({ book_id: "cet4", questions: [
        { key: "talk", qtype: "dictation", prompt: { word: "talk" }, options: null, length: 4 }], cards: { talk: BATCH.cards.talk } }),
    });
    const start = await screen.findByRole("button", { name: /开始复习/ });
    await waitFor(() => expect(start).toBeEnabled());
    await userEvent.click(start);
    expect(await screen.findByText("听写")).toBeTruthy();
    expect(screen.queryByText("talk")).toBeNull();
    await waitFor(() => expect(play).toHaveBeenCalledWith(expect.any(String), "talk", "openai/tts-1", "alloy"));
  });
});
