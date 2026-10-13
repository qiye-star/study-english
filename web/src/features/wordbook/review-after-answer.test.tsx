import "fake-indexeddb/auto";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { LookupLayer } from "~/features/lookup";
import i18n from "~/i18n";
import { createFetchMock, json, type RecordedCall } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookReviewPage } from "./review-page";
import { CONFIG, ENROLLED_TODAY, PLAN, card, defsCard } from "./test-fixtures";

vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play: vi.fn(), playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
}));

const TTS = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

const OPT_ACCEPT = "vt. 接受；承认";
const MEANING_Q = { key: "accept", qtype: "meaning", prompt: { word: "accept", us: "əkˈsɛpt" }, options: ["v. 放弃；抛弃", OPT_ACCEPT, "v. 携带；搬运", "v. 停止"], length: null as number | null };
const WORD_Q = { key: "carry", qtype: "word", prompt: { meaning: "v. 携带；搬运" }, options: ["stop", "carry", "go", "child"], length: null as number | null };
const CLOZE_Q = { key: "go", qtype: "cloze", prompt: { sentence: "I _____ home.", zh: "我回家。" }, options: ["go", "stop", "child", "carry"], length: null as number | null };
const BATCH = {
  book_id: "cet4", questions: [MEANING_Q, WORD_Q, CLOZE_Q],
  cards: [
    defsCard("accept", { senses: [{ pos: "vt", text: "接受；承认" }], defs_en: [{ pos: "v", text: "agree to take something offered" }], phrases: [{ en: "accept defeat", zh: "认输" }] }),
    defsCard("carry", { senses: [{ pos: "vt", text: "携带；搬运" }], defs_en: [{ pos: "v", text: "hold something and take it somewhere" }] }),
    card("go"),
  ],
};
const info = (option: string, word: string, zh: [string, string], en: string[] = []) => ({
  option, word, defs_zh: [{ pos: zh[0], text: zh[1] }], defs_en: en.map((text) => ({ pos: "v", text })),
});
const INFO: Record<string, unknown[]> = {
  accept: [
    info("v. 放弃；抛弃", "abandon", ["vt", "放弃；抛弃"], ["leave something or someone for good"]),
    info(OPT_ACCEPT, "accept", ["vt", "接受；承认"], ["agree to take something offered"]),
    info("v. 携带；搬运", "carry", ["vt", "携带；搬运"], ["hold something and take it somewhere"]),
    info("v. 停止", "stop", ["v", "停止"]),
  ],
  carry: [info("stop", "stop", ["v", "停止"]), info("carry", "carry", ["vt", "携带；搬运"], ["hold it"]), info("go", "go", ["v", "去"]), info("child", "child", ["n", "孩子"])],
};
const CORRECT: Record<string, string> = { accept: OPT_ACCEPT, carry: "carry", go: "go" };
let withInfo = true;

function answerRoute(call: RecordedCall) {
  const body = JSON.parse(String(call.body)) as { key: string; choice?: string };
  const ok = body.choice === CORRECT[body.key];
  return json({
    correct: ok, outcome: ok ? "correct" : "wrong", grade: ok ? "good" : "forgot", expected: body.key, correct_option: CORRECT[body.key], diff: null,
    item: { box: 2, due_at: "x" }, applied: true, rating: null, spot_check: false, check: null,
    ...(withInfo && INFO[body.key] ? { option_info: INFO[body.key], phrases: [{ en: `${body.key} on`, zh: "短语" }], example: { id: "e", en: `They ${body.key} a lot.`, zh: "例" } } : {}),
  });
}

function setup(config: Record<string, unknown> = CONFIG) {
  const mock = createFetchMock({
    ...TTS,
    "GET /api/wordbook/config": () => json(config),
    "GET /api/wordbook/today": () => json({ ...ENROLLED_TODAY, plan: { ...PLAN, review_due: 3, review_left: 3 } }),
    "POST /api/wordbook/review/batch": () => json(BATCH),
    "POST /api/wordbook/answers": answerRoute,
    "POST /api/dictionary/lookup": () => json({ hit: false }),
  });
  renderWithProviders(<><WordbookReviewPage /><LookupLayer /></>, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/review" });
  return mock;
}

const rows = () => screen.getAllByTestId("choice-option");
const wordOf = (row: HTMLElement) => within(row).getByTestId("option-word").textContent;
async function startAndAnswer(user: ReturnType<typeof userEvent.setup>, optionName: RegExp) {
  await user.click(await screen.findByRole("button", { name: "开始复习 3" }));
  await user.click(await screen.findByRole("button", { name: optionName }));
  await screen.findAllByTestId("choice-option");
}

beforeEach(() => {
  withInfo = true;
  localStorage.clear();
  resetServerAiConfigCache();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("review page · after the answer (meaning)", () => {
  it("swaps the options to English words, hides Chinese, shows the study panel and the hint; the request body is unchanged", async () => {
    const user = userEvent.setup();
    const mock = setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    expect(rows().map(wordOf)).toEqual(["abandon", "accept", "carry", "stop"]);
    expect(rows().map((r) => r.getAttribute("data-state"))).toEqual(["wrong", "correct", "idle", "idle"]);
    expect(screen.queryByText("v. 放弃；抛弃")).toBeNull();
    expect(rows()[3]).toHaveTextContent("v. 停止"); // 没有英文释义的词回退成中文
    expect(screen.getByRole("status")).toHaveTextContent("正确答案是"); // 仍然只有一个 status
    const panel = screen.getByTestId("after-answer-panel");
    expect(panel).toHaveTextContent("agree to take something offered");
    expect(panel).toHaveTextContent("accept defeat");
    expect(panel).not.toHaveTextContent("接受；承认");
    expect(screen.getByTestId("double-tap-hint")).toHaveTextContent("双击选项可查词");
    const sent = JSON.parse(String(mock.calls.find((c) => c.url.pathname === "/api/wordbook/answers")?.body)) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["book_id", "choice", "key", "mode", "qtype", "tz_offset_minutes"]);
  });

  it("the 中 switch shows Chinese on the rows and in the panel, and resets for the next question", async () => {
    const user = userEvent.setup();
    setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    await user.click(screen.getByTestId("option-peek"));
    expect(rows()[0]).toHaveTextContent("v. 放弃；抛弃");
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("接受；承认");
    await user.click(screen.getByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: /carry/ }));
    await screen.findAllByTestId("choice-option");
    expect(screen.queryByTestId("option-peek")).toBeNull(); // word 题没有选项级的「中」
    expect(screen.queryByTestId("double-tap-hint")).toBeNull(); // 只提示一次
  });

  it("honours def_lang 'zh': Chinese on the rows, no switch, Chinese in the panel", async () => {
    const user = userEvent.setup();
    setup({ ...CONFIG, def_lang: "zh" });
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    expect(rows()[0]).toHaveTextContent("v. 放弃；抛弃");
    expect(screen.queryByTestId("option-peek")).toBeNull();
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("接受；承认");
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
  });

  it("degrades to the old look plus a panel built from the batch card when the server sent no option info", async () => {
    withInfo = false;
    const user = userEvent.setup();
    setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    expect(rows()[0]).toHaveTextContent("v. 放弃；抛弃");
    expect(rows()[0].querySelector("s")).not.toBeNull();
    expect(screen.queryByTestId("option-word")).toBeNull();
    expect(screen.queryByTestId("double-tap-hint")).toBeNull();
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("agree to take something offered");
  });
});

describe("review page · after the answer (word and cloze)", () => {
  it("shows words with Chinese and part of speech under the options and the correct word's card below", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "开始复习 3" }));
    await user.click(await screen.findByRole("button", { name: /vt\. 接受；承认/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: /carry/ }));
    await screen.findAllByTestId("choice-option");
    expect(rows().map(wordOf)).toEqual(["stop", "carry", "go", "child"]);
    expect(rows()[1]).toHaveTextContent("vt. 携带；搬运");
    const wc = screen.getByTestId("word-card");
    expect(wc).toHaveTextContent("carry");
    expect(wc).toHaveTextContent("hold something and take it somewhere");
  });

  it("leaves cloze exactly as it was: disabled option buttons, no panel", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "开始复习 3" }));
    await user.click(await screen.findByRole("button", { name: /vt\. 接受；承认/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: /carry/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: /go/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /go/ })).toHaveAttribute("data-state", "correct"));
    expect(screen.queryByTestId("choice-option")).toBeNull();
    expect(screen.queryByTestId("after-answer-panel")).toBeNull();
    expect(screen.queryByTestId("word-card")).toBeNull();
  });
});

describe("review page · double tap opens the lookup bar", () => {
  it("selects the option's word and the global selection bar appears", async () => {
    const user = userEvent.setup();
    setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    fireEvent.click(rows()[2], { detail: 1 });
    fireEvent.click(rows()[2], { detail: 2 });
    expect(window.getSelection()?.toString()).toBe("carry");
    expect(await screen.findByTestId("lookup-bar")).toBeTruthy();
    expect(screen.getByTestId("lookup-trigger")).toBeTruthy();
  });
});
