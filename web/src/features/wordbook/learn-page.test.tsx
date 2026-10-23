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
import { ZH_DEFS_PREF_KEY } from "~/lib/storage";
import { resetZhDefsModeMemory, setZhDefsMode } from "~/settings/zh-defs-pref";
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

const BATCH: Record<string, unknown> & { cards: unknown[]; quiz: unknown[]; drill: unknown[] } = {
  book_id: "cet4",
  cards: [card("talk", { us: "tɔk", uk: "tɔːk", senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }],
    examples: [{ id: "s1", en: "I could hear Sarah and Andy talking in the next room.", zh: "我听到萨拉和安迪在隔壁讲话。" }] }),
  card("accept", { senses: [{ pos: "vt", text: "接受；承认" }] })],
  quiz: [
    { key: "talk", qtype: "meaning", prompt: { word: "talk", us: "tɔk" }, options: ["v. 放弃；抛弃", "v. 说话；谈话；n. 交谈", "v. 携带；搬运", "v. 吸收；使专心"], length: null },
    { key: "accept", qtype: "meaning", prompt: { word: "accept", us: "us-accept" }, options: ["vt. 接受；承认", "v. 携带；搬运", "n. 能力", "v. 停止"], length: null },
  ],
  drill: [
    { key: "talk", qtype: "word", prompt: { meaning: "v. 说话；谈话；n. 交谈" }, options: ["accept", "talk", "carry", "stop"], length: null },
    { key: "accept", qtype: "word", prompt: { meaning: "vt. 接受；承认" }, options: ["talk", "accept", "carry", "stop"], length: null },
  ],
};

const CORRECT: Record<string, string> = { talk: "v. 说话；谈话；n. 交谈", accept: "vt. 接受；承认" };
/** 服务端会抽查的词(测试里按需打开) */
let SPOT = new Set<string>();

function answerRoute(call: RecordedCall) {
  const body = JSON.parse(String(call.body)) as { key: string; qtype: string; choice?: string; rating?: "know" | "fuzzy" | "unknown"; revealed_before?: boolean };
  if (body.qtype === "recall") {
    const rating = body.rating === "know" && body.revealed_before ? "fuzzy" : body.rating ?? "unknown";
    const spot = rating === "know" && SPOT.has(body.key);
    const box = { know: spot ? 1 : 2, fuzzy: 1, unknown: 0 }[rating];
    return json({ correct: rating === "know", outcome: spot ? "know_chk" : rating, grade: "good", expected: body.key, correct_option: null, diff: null,
      item: { box, due_at: "x" }, applied: true, rating, spot_check: spot, check: null });
  }
  const ok = body.choice === CORRECT[body.key] || body.choice === body.key;
  return json({ correct: ok, outcome: ok ? "correct" : "wrong", grade: ok ? "good" : "forgot", expected: body.key,
    correct_option: body.qtype === "word" ? body.key : CORRECT[body.key] ?? null, diff: null, item: { box: 0, due_at: "x" }, applied: true,
    rating: null, spot_check: false, check: null });
}

function routes(extra: Parameters<typeof createFetchMock>[0] = {}) {
  return {
    ...TTS_ROUTES,
    "GET /api/wordbook/config": () => json(CONFIG),
    "POST /api/wordbook/learn/batch": () => json(BATCH),
    "POST /api/wordbook/answers": answerRoute,
    ...extra,
  };
}

function setup(extra: Parameters<typeof createFetchMock>[0] = {}) {
  const mock = createFetchMock(routes(extra));
  renderWithProviders(<WordbookLearnPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/learn" });
  return mock;
}

function setupStrict(extra: Parameters<typeof createFetchMock>[0] = {}) {
  const mock = createFetchMock(routes(extra));
  renderWithProviders(<StrictMode><WordbookLearnPage /></StrictMode>, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/learn" });
  return mock;
}

const answers = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/wordbook/answers").map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);

const heading = () => within(screen.getByTestId("word-card")).getByRole("heading").textContent;

beforeEach(() => {
  resetServerAiConfigCache();
  play.mockReset();
  prime.mockReset();
  SPOT = new Set();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  localStorage.removeItem(ZH_DEFS_PREF_KEY);
  resetZhDefsModeMemory();
  void i18n.changeLanguage("en");
});

describe("WordbookLearnPage", () => {
  it("covers the Chinese meaning of an opened card when 我的 → 中文释义 is on tap", async () => {
    const user = userEvent.setup();
    setZhDefsMode("tap");
    setup();
    await screen.findByTestId("word-card");
    expect(screen.queryByTestId("zh-defs-cover")).toBeNull(); // 遮罩还在
    await user.click(screen.getByRole("button", { name: "模糊" }));
    const cover = await screen.findByTestId("zh-defs-cover");
    expect(cover).toHaveAttribute("data-state", "hidden");
    await user.click(screen.getByRole("button", { name: "显示中文释义" }));
    expect(screen.getByText("说话；谈话")).toBeVisible();
  });

  it("covers the meaning, rates, reveals and quizzes fuzzy and unknown words", async () => {
    const user = userEvent.setup();
    const mock = setup();
    const first = await screen.findByTestId("word-card");
    expect(within(first).getByRole("heading", { name: "talk" })).toBeTruthy();
    expect(first).toHaveTextContent("tɔk");
    expect(first).not.toHaveTextContent("说话；谈话");
    expect(first).not.toHaveTextContent("Sarah");
    expect(screen.getByRole("button", { name: /显示释义/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "下一个" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "模糊" }));
    await waitFor(() => expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话"));
    expect(screen.getByTestId("word-card").querySelector("mark")?.textContent).toBe("talking");
    expect(screen.getByTestId("rating-badge")).toHaveTextContent("模糊");
    expect(screen.getByText("已记为模糊")).toBeTruthy();
    expect(answers(mock)[0]).toMatchObject({ book_id: "cet4", key: "talk", mode: "learn", qtype: "recall", rating: "fuzzy", revealed_before: false });
    expect(typeof answers(mock)[0].elapsed_ms).toBe("number");
    expect(screen.queryByRole("button", { name: "记错了" })).toBeNull(); // 只有「认识」之后才有
    const next = screen.getByRole("button", { name: "下一个" });
    await waitFor(() => expect(document.activeElement).toBe(next));
    await user.click(next);

    expect(heading()).toBe("accept");
    expect(screen.queryByTestId("rating-badge")).toBeNull();
    play.mockClear();
    await user.click(await screen.findByRole("button", { name: "不认识" }));
    expect(play).toHaveBeenCalledWith(expect.any(String), "accept", "openai/tts-1", expect.any(String)); // 不认识总是朗读
    await user.click(await screen.findByRole("button", { name: "开始小测" }));

    // 队列:talk(模糊)选释义 → accept(不认识)选释义 → accept 看释义选词
    expect(await screen.findByText("talk", { selector: "[data-testid=question-word]" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
    await user.click(screen.getByRole("button", { name: /说话；谈话；n\. 交谈/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("答对了"));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    expect(await screen.findByText("accept", { selector: "[data-testid=question-word]" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /接受；承认/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    expect(await screen.findByText("再认一次")).toBeTruthy();
    expect(screen.getByTestId("question-meaning")).toHaveTextContent("vt. 接受；承认");
    await user.click(screen.getByRole("button", { name: /accept/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    const summary = await screen.findByTestId("session-summary");
    expect(within(summary).getByRole("status").textContent).toBe("学会 2 个新词 · 一次答对 2");
    expect(within(summary).getByTestId("summary-ratings").textContent).toBe("认识 0 · 模糊 1 · 不认识 1");
    const quiz = answers(mock).filter((a) => a.qtype !== "recall");
    expect(quiz.map((a) => `${a.qtype}:${a.key}`)).toEqual(["meaning:talk", "meaning:accept", "word:accept"]);
    expect(quiz.every((a) => a.mode === "learn")).toBe(true);
  }, 15_000);

  it("a missed quiz question comes back once and shows the word recap", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByTestId("word-card");
    await user.click(screen.getByRole("button", { name: "模糊" }));
    await user.click(await screen.findByRole("button", { name: "下一个" }));
    await user.click(await screen.findByRole("button", { name: "认识" }));
    await user.click(await screen.findByRole("button", { name: "开始小测" }));
    await user.click(await screen.findByRole("button", { name: /携带；搬运/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("正确答案是 v. 说话；谈话；n. 交谈"));
    expect(screen.getByTestId("word-recap")).toHaveTextContent("talk");
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(await screen.findByText("talk", { selector: "[data-testid=question-word]" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /说话；谈话；n\. 交谈/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    const summary = await screen.findByTestId("session-summary");
    // talk 第一次答错;accept 没抽中的认识算一次答对
    expect(within(summary).getByRole("status").textContent).toBe("学会 2 个新词 · 一次答对 1");
    expect(summary).toHaveTextContent("需要再看看");
  }, 15_000);

  it("a peek turns 认识 into 模糊 and says so before the tap", async () => {
    const user = userEvent.setup();
    const mock = setup();
    await screen.findByTestId("word-card");
    await user.click(screen.getByRole("button", { name: /显示释义/ }));
    expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话");
    expect(screen.queryByRole("button", { name: /显示释义/ })).toBeNull();
    await waitFor(() => expect(document.activeElement?.id).toBeTruthy());
    expect(screen.getByRole("button", { name: "认识" })).toHaveAccessibleDescription("已看过释义:点「认识」会记为「模糊」");
    await user.click(screen.getByRole("button", { name: "认识" }));
    await waitFor(() => expect(answers(mock)[0]).toMatchObject({ rating: "know", revealed_before: true }));
    expect(await screen.findByTestId("rating-badge")).toHaveTextContent("模糊");
    expect(screen.queryByRole("button", { name: "记错了" })).toBeNull();
  });

  it("plain 认识 skips the quiz; a spot-checked 认识 is quizzed once", async () => {
    const user = userEvent.setup();
    SPOT.add("accept");
    const mock = setup();
    await screen.findByTestId("word-card");
    await user.click(screen.getByRole("button", { name: "认识" }));
    expect(await screen.findByTestId("rating-badge")).toHaveTextContent("认识");
    await user.click(await screen.findByRole("button", { name: "下一个" }));
    await user.click(await screen.findByRole("button", { name: "认识" }));
    expect(await screen.findByTestId("rating-badge")).toHaveTextContent("认识 · 本轮抽查");
    await user.click(screen.getByRole("button", { name: "开始小测" }));
    expect(await screen.findByText("抽查 · 你标了「认识」")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /接受；承认/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    const summary = await screen.findByTestId("session-summary");
    expect(summary).toHaveTextContent("100%");
    expect(within(summary).getByTestId("summary-ratings").textContent).toBe("认识 2 · 模糊 0 · 不认识 0 · 抽查 1 · 通过 1");
    expect(answers(mock).filter((a) => a.qtype !== "recall").map((a) => a.key)).toEqual(["accept"]);
  });

  it("a round of plain 认识 goes straight to a 100% summary", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByTestId("word-card");
    await user.click(screen.getByRole("button", { name: "认识" }));
    await user.click(await screen.findByRole("button", { name: "下一个" }));
    await user.click(await screen.findByRole("button", { name: "认识" }));
    await user.click(await screen.findByRole("button", { name: "开始小测" }));
    const summary = await screen.findByTestId("session-summary");
    expect(within(summary).getByRole("status").textContent).toBe("学会 2 个新词 · 一次答对 2");
    expect(summary).toHaveTextContent("100%");
  });

  it("记错了 re-rates the word as unknown and queues it twice", async () => {
    const user = userEvent.setup();
    const mock = setup();
    await screen.findByTestId("word-card");
    await user.click(screen.getByRole("button", { name: "认识" }));
    await user.click(await screen.findByRole("button", { name: "记错了" }));
    await waitFor(() => expect(answers(mock)[1]).toMatchObject({ key: "talk", qtype: "recall", rating: "unknown" }));
    expect(await screen.findByTestId("rating-badge")).toHaveTextContent("不认识");
    expect(screen.queryByRole("button", { name: "记错了" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "下一个" })));
    await user.click(screen.getByRole("button", { name: "下一个" }));
    await user.click(await screen.findByRole("button", { name: "认识" }));
    await user.click(await screen.findByRole("button", { name: "开始小测" }));
    expect(await screen.findByText("talk", { selector: "[data-testid=question-word]" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /说话；谈话；n\. 交谈/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    expect(await screen.findByText("再认一次")).toBeTruthy();
  });

  it("two 模糊 in a row come back as unknown and say why", async () => {
    const user = userEvent.setup();
    setup({
      "POST /api/wordbook/answers": (call) => {
        const body = JSON.parse(String(call.body)) as { key: string; qtype: string };
        if (body.qtype !== "recall") return answerRoute(call);
        return json({ correct: false, outcome: "unknown", grade: "good", expected: body.key, correct_option: null, diff: null,
          item: { box: 0, due_at: "x" }, applied: true, rating: "unknown", spot_check: false, check: null });
      },
    });
    await screen.findByTestId("word-card");
    await user.click(screen.getByRole("button", { name: "模糊" }));
    expect(await screen.findByTestId("rating-badge")).toHaveTextContent("不认识");
    expect(screen.getByText("连续两次模糊,按不认识记")).toBeTruthy();
  });

  it("a failed rating keeps the cover and the buttons usable", async () => {
    const user = userEvent.setup();
    let fail = true;
    setup({
      "POST /api/wordbook/answers": (call) => (fail ? json({ error: "Daily answer limit reached" }, 429) : answerRoute(call)),
    });
    await screen.findByTestId("word-card");
    await user.click(screen.getByRole("button", { name: "模糊" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("今天作答次数已达上限");
    expect(screen.getByRole("button", { name: /显示释义/ })).toBeTruthy();
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("说话；谈话");
    fail = false;
    await user.click(screen.getByRole("button", { name: "模糊" }));
    expect(await screen.findByTestId("rating-badge")).toHaveTextContent("模糊");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("autoplays each card once after the first tap and respects the autoplay setting", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByTestId("word-card");
    await waitFor(() => expect(screen.getByRole("button", { name: "朗读美音" })).toBeEnabled());
    expect(play).not.toHaveBeenCalled(); // 第一张卡出现时还没有手势(iOS)
    await user.click(screen.getByRole("button", { name: "模糊" }));
    await waitFor(() => expect(play).toHaveBeenCalledWith(expect.any(String), "talk", "openai/tts-1", expect.any(String)));
    play.mockClear();
    await user.click(screen.getByRole("button", { name: "下一个" }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(play).toHaveBeenCalledWith(expect.any(String), "accept", "openai/tts-1", expect.any(String));
    play.mockClear();
    await user.click(screen.getByRole("button", { name: "认识" }));
    await screen.findByTestId("rating-badge");
    expect(play).not.toHaveBeenCalled(); // 已在出现时朗读过,认识不再读
  });

  it("does not autoplay when the server turns it off, but 不认识 still reads", async () => {
    const user = userEvent.setup();
    setup({ "GET /api/wordbook/config": () => json({ ...CONFIG, learn: { autoplay: false, show_example: false } }) });
    await screen.findByTestId("word-card");
    await waitFor(() => expect(screen.getByRole("button", { name: "朗读美音" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "模糊" }));
    await screen.findByTestId("rating-badge");
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("Sarah"); // show_example 关
    await user.click(screen.getByRole("button", { name: "下一个" }));
    await user.click(await screen.findByRole("button", { name: "不认识" }));
    await screen.findByTestId("rating-badge");
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith(expect.any(String), "accept", "openai/tts-1", expect.any(String));
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

  it("still rates, quizzes and shows results under StrictMode (double-mounted effects)", async () => {
    const user = userEvent.setup();
    const mock = setupStrict();
    await screen.findByTestId("word-card");
    await user.click(screen.getByRole("button", { name: "认识" }));
    expect(await screen.findByTestId("rating-badge")).toHaveTextContent("认识");
    await user.click(screen.getByRole("button", { name: "下一个" }));
    await waitFor(() => expect(heading()).toBe("accept"));
    await user.click(screen.getByRole("button", { name: "模糊" }));
    expect(await screen.findByTestId("rating-badge")).toHaveTextContent("模糊");
    await user.click(screen.getByRole("button", { name: "开始小测" }));
    await user.click(await screen.findByRole("button", { name: /接受；承认/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("答对了"));
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(await screen.findByTestId("session-summary")).toHaveTextContent("100%");
    expect(answers(mock).filter((a) => a.qtype === "recall")).toHaveLength(2);
  });

  it("autoplays a card exactly once under StrictMode", async () => {
    const user = userEvent.setup();
    setupStrict();
    await screen.findByTestId("word-card");
    await waitFor(() => expect(screen.getByRole("button", { name: "朗读美音" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "模糊" }));
    await user.click(await screen.findByRole("button", { name: "下一个" }));
    await waitFor(() => expect(heading()).toBe("accept"));
    await waitFor(() => expect(play.mock.calls.filter((c) => c[1] === "accept")).toHaveLength(1));
  });

  it("says when today's new words are done", async () => {
    setup({ "POST /api/wordbook/learn/batch": () => json({ book_id: "cet4", cards: [], quiz: [], drill: [] }) });
    expect(await screen.findByText("今天的新词学完了")).toBeTruthy();
    expect(screen.getByRole("link", { name: "回到首页" })).toHaveAttribute("href", "/wordbook");
  });

  it("shows a translated error when there is no active book", async () => {
    setup({ "POST /api/wordbook/learn/batch": () => json({ error: "No active book" }, 409) });
    expect(await screen.findByText("先选一本词书")).toBeTruthy();
  });
});
