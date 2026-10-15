import "fake-indexeddb/auto";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { LookupLayer } from "~/features/lookup";
import i18n from "~/i18n";
import { createFetchMock, json, type RecordedCall } from "~/test/fetch-mock";
import { setLiquid } from "~/test/glass";
import { renderWithProviders } from "~/test/render";
import { TestPointerEvent, installHighlightStub, stubCaret, tapAt, unstubCaret } from "~/test/tap-lookup";
import { WordbookReviewPage } from "./review-page";
import { CONFIG, ENROLLED_TODAY, PLAN, defsCard } from "./test-fixtures";

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
const OPT = "vt. 接受；承认";
const Q1 = { key: "accept", qtype: "meaning", prompt: { word: "accept", us: "x" }, options: ["v. 放弃；抛弃", OPT, "v. 携带；搬运", "v. 停止"], length: null as number | null };
const Q2 = { key: "carry", qtype: "word", prompt: { meaning: "v. 携带；搬运" }, options: ["stop", "carry", "go", "child"], length: null as number | null };
const BATCH = { book_id: "cet4", questions: [Q1, Q2], cards: [defsCard("accept", { senses: [{ pos: "vt", text: "接受" }] }), defsCard("carry", { senses: [{ pos: "vt", text: "携带" }] })] };
const info = (option: string, word: string) => ({ option, word, defs_zh: [{ pos: "v", text: "释义" }], defs_en: [] as unknown[] });
const OPTION_INFO = [info("v. 放弃；抛弃", "abandon"), info(OPT, "accept"), info("v. 携带；搬运", "carry"), info("v. 停止", "stop")];

function answerRoute(call: RecordedCall) {
  const body = JSON.parse(String(call.body)) as { key: string; choice?: string };
  const ok = body.choice === OPT;
  return json({ correct: ok, outcome: ok ? "correct" : "wrong", grade: ok ? "good" : "forgot", expected: body.key, correct_option: OPT, diff: null, item: { box: 2, due_at: "x" }, applied: true, rating: null, spot_check: false, check: null, option_info: OPTION_INFO });
}

function setup() {
  const mock = createFetchMock({
    ...TTS,
    "GET /api/wordbook/config": () => json(CONFIG),
    "GET /api/wordbook/today": () => json({ ...ENROLLED_TODAY, plan: { ...PLAN, review_due: 2, review_left: 2 } }),
    "POST /api/wordbook/review/batch": () => json(BATCH),
    "POST /api/wordbook/answers": answerRoute,
    "POST /api/dictionary/lookup": () => json({ hit: false }),
    "POST /api/lookup": () => json({ word: "carry", definition: "d", translation: "t" }),
  });
  renderWithProviders(<><WordbookReviewPage /><LookupLayer /></>, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/review" });
  return mock;
}

const rows = () => screen.getAllByTestId("choice-option");
const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

beforeAll(() => { vi.stubGlobal("PointerEvent", TestPointerEvent); });
afterAll(() => { vi.unstubAllGlobals(); });

let highlights: ReturnType<typeof installHighlightStub>;
beforeEach(() => {
  highlights = installHighlightStub();
  localStorage.clear();
  resetServerAiConfigCache();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
  setLiquid(true);
});
afterEach(() => {
  unstubCaret();
  vi.restoreAllMocks();
  setLiquid(false);
  window.getSelection()?.removeAllRanges();
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

/** The browser collapses the selection when a finger lands on non-selected content (Android). */
const collapseNative = () => {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event("selectionchange"));
};

async function answerQuestion() {
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole("button", { name: "开始复习 2" }));
  await user.click(await screen.findByRole("button", { name: /v\. 放弃；抛弃/ }));
  await screen.findAllByTestId("choice-option");
  return user;
}
/** Tap the English word of option row `i` (rows 0-3 here are meaning rows: word on the small line). */
function tapOptionWord(i: number) {
  const word = within(rows()[i]).getByTestId("option-word");
  stubCaret(word.firstChild!, 2);
  tapAt(word);
}

async function lookupBarFromTaps() {
  await answerQuestion();
  tapOptionWord(2);
  tapOptionWord(2);
  expect(window.getSelection()?.toString()).toBe("carry");
  return screen.findByTestId("lookup-bar");
}

describe("review page: tap-to-lookup on the answered options", () => {
  it("one tap underlines the word (marker only, no selection, no bar); the question does not advance", async () => {
    await answerQuestion();
    tapOptionWord(2);
    expect(highlights.rangesOf("lookup-pending").map((r) => r.toString())).toEqual(["carry"]);
    expect(window.getSelection()?.toString()).toBe("");
    expect(screen.queryByTestId("lookup-bar")).toBeNull();
    expect(screen.getAllByTestId("choice-option")).toHaveLength(4);
  });

  it("the second tap on the same word selects it and the lookup bar appears for a word, the marker is gone", async () => {
    const bar = await lookupBarFromTaps();
    expect(within(bar).getByTestId("lookup-trigger")).toBeTruthy();
    expect(highlights.registry.has("lookup-pending")).toBe(false);
  });

  it("tapping another option's word moves the marker", async () => {
    await answerQuestion();
    tapOptionWord(2);
    tapOptionWord(3);
    expect(highlights.rangesOf("lookup-pending").map((r) => r.toString())).toEqual(["stop"]);
    expect(screen.queryByTestId("lookup-bar")).toBeNull();
  });

  it("before answering nothing is marked or looked up: the options are buttons and the prompt is not a lookup context", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "开始复习 2" }));
    const option = await screen.findByRole("button", { name: /v\. 放弃；抛弃/ });
    const prompt = screen.getByTestId("question-word");
    stubCaret(prompt.firstChild!, 2);
    tapAt(prompt);
    tapAt(prompt);
    stubCaret(option.firstChild ?? option, 0);
    tapAt(option);
    expect(highlights.registry.has("lookup-pending")).toBe(false);
    expect(screen.queryByTestId("lookup-bar")).toBeNull();
  });
});

describe("review page: tapping the lookup bar after a tap-selected word (owner report)", () => {
  it("a touch tap whose touchstart collapses the selection still opens the drawer, and the question does not advance", async () => {
    const bar = await lookupBarFromTaps();
    const trigger = within(bar).getByTestId("lookup-trigger");
    // finger down on the bar: pointerdown, touchstart, then the OS collapses the selection
    fireEvent.pointerDown(trigger, { pointerId: 2, pointerType: "touch", isPrimary: true });
    fireEvent.touchStart(trigger);
    collapseNative();
    await sleep(350); // longer than the 300 ms debounce: the bar must survive the held press
    expect(screen.queryByTestId("lookup-bar")).not.toBeNull();
    fireEvent.pointerUp(trigger, { pointerId: 2, pointerType: "touch" });
    fireEvent.touchEnd(trigger);
    await sleep(100);
    fireEvent.mouseDown(trigger);
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);
    expect(await screen.findByTestId("lookup-drawer")).toBeTruthy();
    expect(screen.getByTestId("lookup-drawer")).toHaveTextContent("carry");
    expect(screen.getAllByTestId("choice-option")).toHaveLength(4); // still on the answered question
    expect(screen.getByRole("button", { name: "继续", hidden: true })).toBeTruthy(); // Radix hides the page behind the open drawer
  });

  it("the bar is not unmounted by the grace timer while a click is still on its way (slow Android click, 550 ms after release)", async () => {
    const bar = await lookupBarFromTaps();
    const trigger = within(bar).getByTestId("lookup-trigger");
    fireEvent.pointerDown(trigger, { pointerId: 2, pointerType: "touch", isPrimary: true });
    fireEvent.touchStart(trigger);
    collapseNative();
    fireEvent.pointerUp(trigger, { pointerId: 2, pointerType: "touch" });
    fireEvent.touchEnd(trigger);
    await sleep(550);
    fireEvent.click(trigger);
    expect(await screen.findByTestId("lookup-drawer")).toBeTruthy();
  });
});

describe("review page: bar vs DOCK vs tab bar stacking (class tokens; jsdom has no layout)", () => {
  it("the bar's z-index is above the DOCK's and the tab bar's", async () => {
    const bar = await lookupBarFromTaps();
    const z = (el: Element) => Number(/(?:^|\s)z-(\d+)(?:\s|$)/.exec(el.className)?.[1] ?? "0");
    const dock = screen.getByRole("button", { name: "继续" }).parentElement!;
    expect(z(bar)).toBeGreaterThan(z(dock));
    expect(z(bar)).toBeGreaterThan(30); // GlassTabBar is z-30
  });
});

describe("review page: the DOCK registers its space so the lookup bar lifts above it", () => {
  it("--dock-space is set while the answered question's DOCK is mounted and removed afterwards", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 66, top: 0, bottom: 66, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const bar = await longPressOption();
    expect(document.documentElement.style.getPropertyValue("--dock-space")).toBe("66px");
    expect(bar.className).toContain("var(--dock-space,0px)");
    await userEvent.setup().click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "继续" })).toBeNull());
    expect(document.documentElement.style.getPropertyValue("--dock-space")).toBe("");
  });
});
