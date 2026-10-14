import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { ChoiceQuestion, type AfterAnswer, type ChoiceResult } from "./choice-question";
import type { OptionInfo, Question } from "./wordbook-api";

// jsdom has no PointerEvent: without one, fireEvent builds a plain Event and drops clientX / button / pointerId (same stub as use-long-press.test.tsx).
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.isPrimary = init.isPrimary ?? true;
  }
}
beforeAll(() => { vi.stubGlobal("PointerEvent", TestPointerEvent); });
afterAll(() => { vi.unstubAllGlobals(); });

const OPT_TALK = "v. 说话；谈话；n. 交谈";
const meaning: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk", us: "tɔk" }, options: [OPT_TALK, "n. 事故", "v. 放弃"], length: null };
const INFO: OptionInfo[] = [
  { option: OPT_TALK, word: "talk", defsZh: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }], defsEn: [{ pos: "v", text: "speak to someone" }] },
  { option: "n. 事故", word: "accident", defsZh: [{ pos: "n", text: "事故" }], defsEn: [{ pos: "n", text: "something bad that happens by chance" }] },
  { option: "v. 放弃", word: "abandon", defsZh: [{ pos: "vt", text: "放弃" }], defsEn: [] },
];
const wordQ: Question = { key: "talk", qtype: "word", prompt: { meaning: OPT_TALK }, options: ["accept", "talk", "stop"], length: null };
const WORD_INFO: OptionInfo[] = [
  { option: "accept", word: "accept", defsZh: [{ pos: "vt", text: "接受；承认" }], defsEn: [] },
  { option: "talk", word: "talk", defsZh: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }], defsEn: [] },
  { option: "stop", word: "stop", defsZh: [{ pos: "v", text: "停止" }], defsEn: [] },
];
const cloze: Question = { key: "carry", qtype: "cloze", prompt: { sentence: "He _____ it.", zh: "他搬它。" }, options: ["stop", "carry"], length: null };

const wrongPick: ChoiceResult = { choice: "n. 事故", correct: false, correctOption: OPT_TALK };
const after = (extra: Partial<AfterAnswer> = {}): AfterAnswer => ({ info: INFO, ...extra });
const view = (q: Question, result: ChoiceResult | null, a?: AfterAnswer) =>
  render(<ChoiceQuestion question={q} result={result} onAnswer={vi.fn()} onListen={vi.fn()} after={a} />);
const rows = () => screen.getAllByTestId("choice-option");
const wordOf = (row: HTMLElement) => within(row).getByTestId("option-word").textContent;
const mainOf = (row: HTMLElement) => within(row).getByTestId("option-main").textContent;
const selected = () => window.getSelection()?.toString() ?? "";
const press = (el: HTMLElement, x = 10, y = 10) =>
  fireEvent.pointerDown(el, { pointerId: 1, clientX: x, clientY: y, button: 0, isPrimary: true });

beforeEach(() => {
  localStorage.clear();
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  void i18n.changeLanguage("en");
});

describe("ChoiceQuestion before the answer / without `after`", () => {
  it("keeps the options as buttons until there is a result", () => {
    view(meaning, null, after());
    expect(screen.getAllByRole("button").filter((b) => b.closest("li") !== null && b.getAttribute("data-state"))).toHaveLength(3);
    expect(screen.queryByTestId("choice-option")).toBeNull();
    expect(screen.queryByTestId("long-press-hint")).toBeNull();
  });

  it("leaves the learn page / spot-check rendering alone: no `after` means disabled buttons after the answer", () => {
    view(meaning, wrongPick);
    const buttons = screen.getAllByRole("button").filter((b) => b.closest("li") !== null && b.getAttribute("data-state"));
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByTestId("choice-option")).toBeNull();
  });

  it("keeps cloze as disabled buttons when `after` has no option info (old server / memo miss)", () => {
    view(cloze, { choice: "stop", correct: false, correctOption: "carry" }, after({ info: undefined }));
    const buttons = screen.getAllByRole("button").filter((b) => b.closest("li") !== null && b.getAttribute("data-state"));
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByTestId("choice-option")).toBeNull();
  });
});

describe("ChoiceQuestion · cloze, after the answer", () => {
  it("shows each English word with a small 'pos. Chinese' line, like word", () => {
    const info: OptionInfo[] = [
      { option: "stop", word: "stop", defsZh: [{ pos: "v", text: "停止" }], defsEn: [] },
      { option: "carry", word: "carry", defsZh: [{ pos: "vt", text: "携带；搬运" }], defsEn: [] },
    ];
    view(cloze, { choice: "stop", correct: false, correctOption: "carry" }, after({ info }));
    expect(rows().map(wordOf)).toEqual(["stop", "carry"]);
    expect(rows()[1]).toHaveTextContent("vt. 携带；搬运");
    expect(rows().map((r) => r.getAttribute("data-state"))).toEqual(["wrong", "correct"]);
    expect(screen.getByTestId("long-press-hint")).toBeTruthy();
  });
});

describe("ChoiceQuestion · meaning, after the answer (R-Z1: bilingual rows)", () => {
  it("keeps every option's Chinese as the main line and adds its English word underneath, on correct and wrong rows alike", () => {
    view(meaning, wrongPick, after());
    expect(rows().map(mainOf)).toEqual([OPT_TALK, "n. 事故", "v. 放弃"]);
    expect(rows().map(wordOf)).toEqual(["talk", "accident", "abandon"]);
    expect(rows().map((r) => r.getAttribute("data-state"))).toEqual(["correct", "wrong", "idle"]);
    for (const row of rows()) expect(within(row).getByTestId("option-word").closest("small")).not.toBeNull(); // 英文是小字第二行
    expect(rows()[1].querySelector("s")).toBeNull();
  });

  it("has no 中 switch on the question card any more (the study panel owns the 中文 chip)", () => {
    view(meaning, wrongPick, after());
    expect(screen.queryByTestId("option-peek")).toBeNull();
  });

  it("is not a disabled button: a div with touch-action manipulation, no native callout, and a selectable, lookup-ready word", () => {
    view(meaning, wrongPick, after());
    for (const row of rows()) {
      expect(row.tagName).toBe("DIV");
      expect(row.className).toMatch(/\btouch-manipulation\b/);
      expect(row.className).toMatch(/\bselect-none\b/);
      expect(row.className).toContain("[-webkit-touch-callout:none]");
      expect(row).toHaveAttribute("role", "button");
      expect(row).toHaveAttribute("tabindex", "0");
      const word = within(row).getByTestId("option-word");
      expect(word).toHaveAttribute("data-lookup-context");
      expect(word).toHaveAttribute("lang", "en");
      expect(word.className).toMatch(/\bselect-text\b/);
    }
    expect(screen.queryAllByRole("button").filter((b) => b.tagName === "BUTTON" && (b as HTMLButtonElement).disabled)).toHaveLength(0);
  });

  it("matches info by option text, not position (a shuffled or partial list only loses the rows it cannot match)", () => {
    view(meaning, wrongPick, after({ info: [INFO[1], INFO[0]] }));
    expect(wordOf(rows()[0])).toBe("talk");
    expect(wordOf(rows()[1])).toBe("accident");
    expect(within(rows()[2]).queryByTestId("option-word")).toBeNull(); // 没信息的行:原样显示选项原文
    expect(rows()[2]).not.toHaveAttribute("role");
    expect(rows()[2]).toHaveTextContent("v. 放弃");
  });

  it("keeps the old look when the server sent no option info (old server / memo miss): option text, struck through when wrong", () => {
    view(meaning, wrongPick, after({ info: undefined }));
    expect(rows().map((r) => r.textContent?.replace(/正确答案|你选的/g, ""))).toEqual([expect.stringContaining(OPT_TALK), expect.stringContaining("n. 事故"), expect.stringContaining("v. 放弃")]);
    expect(rows()[1].querySelector("s")).not.toBeNull();
    expect(screen.queryByTestId("long-press-hint")).toBeNull();
    expect(rows().every((r) => !r.hasAttribute("role"))).toBe(true);
  });

  it("says the state in words for screen readers (sr-only) on the correct row and on the row you picked", () => {
    view(meaning, wrongPick, after());
    expect(rows()[0]).toHaveTextContent("正确答案");
    expect(rows()[1]).toHaveTextContent("你选的");
    expect(rows()[2]).not.toHaveTextContent("你选的");
  });
});

describe("ChoiceQuestion · word, after the answer (spec D3)", () => {
  const picked: ChoiceResult = { choice: "stop", correct: false, correctOption: "talk" };

  it("shows each word with a small Chinese line and part of speech", () => {
    view(wordQ, picked, after({ info: WORD_INFO }));
    expect(rows().map(wordOf)).toEqual(["accept", "talk", "stop"]);
    expect(rows()[1]).toHaveTextContent("v. 说话；谈话；n. 交谈");
    expect(rows()[0]).toHaveTextContent("vt. 接受；承认");
    expect(screen.queryByTestId("option-peek")).toBeNull();
    expect(rows().map((r) => r.getAttribute("data-state"))).toEqual(["idle", "correct", "wrong"]);
  });

  it("still lets you look a word up when there is no info (the option is the word)", () => {
    view(wordQ, picked, after({ info: undefined }));
    expect(rows().map(wordOf)).toEqual(["accept", "talk", "stop"]);
    expect(screen.getByTestId("long-press-hint")).toBeTruthy();
  });
});

describe("ChoiceQuestion · long press picks the word for the lookup bar (R-L1–R-L5)", () => {
  beforeEach(() => vi.useFakeTimers());

  it("selects the row's English word after holding for 450 ms", () => {
    view(meaning, wrongPick, after());
    press(rows()[1]);
    vi.advanceTimersByTime(449);
    expect(selected()).toBe("");
    vi.advanceTimersByTime(1);
    expect(selected()).toBe("accident");
  });

  it("works on word questions too (the word is the main line)", () => {
    view(wordQ, { choice: "stop", correct: false, correctOption: "talk" }, after({ info: WORD_INFO }));
    press(rows()[0]);
    vi.advanceTimersByTime(450);
    expect(selected()).toBe("accept");
  });

  it("does nothing for a plain tap, a move beyond 8 px, a pointercancel or a scroll", () => {
    view(meaning, wrongPick, after());
    fireEvent.click(rows()[1], { detail: 1 });
    press(rows()[1]);
    fireEvent.pointerMove(rows()[1], { pointerId: 1, clientX: 30, clientY: 10 });
    vi.advanceTimersByTime(600);
    press(rows()[1]);
    fireEvent.pointerCancel(rows()[1], { pointerId: 1 });
    vi.advanceTimersByTime(600);
    press(rows()[1]);
    fireEvent.scroll(document);
    vi.advanceTimersByTime(600);
    expect(selected()).toBe("");
  });

  it("swallows the click after the release and suppresses the native context menu", () => {
    const outer = vi.fn();
    render(<div onClick={outer}><ChoiceQuestion question={meaning} result={wrongPick} onAnswer={vi.fn()} onListen={vi.fn()} after={after()} /></div>);
    press(rows()[1]);
    vi.advanceTimersByTime(450);
    fireEvent.pointerUp(rows()[1], { pointerId: 1 });
    fireEvent.click(rows()[1], { detail: 1 });
    expect(outer).not.toHaveBeenCalled();
    fireEvent.click(rows()[1], { detail: 1 });
    expect(outer).toHaveBeenCalledTimes(1);
    expect(fireEvent.contextMenu(rows()[1])).toBe(false);
  });

  it("looks up at once from the keyboard (Enter / Space) and from an assistive-technology click (detail 0)", () => {
    view(meaning, wrongPick, after());
    fireEvent.keyDown(rows()[0], { key: "Enter" });
    expect(selected()).toBe("talk");
    window.getSelection()?.removeAllRanges();
    fireEvent.keyDown(rows()[1], { key: " " });
    expect(selected()).toBe("accident");
    window.getSelection()?.removeAllRanges();
    fireEvent.click(rows()[2], { detail: 0 });
    expect(selected()).toBe("abandon");
  });

  it("does not override text the user selected by hand elsewhere", () => {
    view(meaning, wrongPick, after());
    const elsewhere = document.createElement("p");
    elsewhere.textContent = "some text";
    document.body.appendChild(elsewhere);
    const range = document.createRange();
    range.selectNodeContents(elsewhere);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    press(rows()[1]);
    vi.advanceTimersByTime(450);
    expect(selected()).toBe("some text");
    elsewhere.remove();
  });

  it("is not active before the answer: holding an option and letting go just answers (R-L1)", () => {
    const onAnswer = vi.fn();
    render(<ChoiceQuestion question={meaning} result={null} onAnswer={onAnswer} onListen={vi.fn()} after={after()} />);
    const option = screen.getByRole("button", { name: /n\. 事故/ });
    press(option);
    vi.advanceTimersByTime(600);
    expect(selected()).toBe("");
    fireEvent.pointerUp(option, { pointerId: 1 });
    fireEvent.click(option);
    expect(onAnswer).toHaveBeenCalledWith("n. 事故");
  });
});

describe("ChoiceQuestion · one-time long-press hint (R-L6)", () => {
  it("shows once after the first answered question and not on the next one", () => {
    const first = view(meaning, wrongPick, after());
    expect(screen.getByTestId("long-press-hint")).toHaveTextContent("长按选项里的单词可查询");
    first.unmount();
    view(wordQ, { choice: "stop", correct: false, correctOption: "talk" }, after({ info: WORD_INFO }));
    expect(screen.queryByTestId("long-press-hint")).toBeNull();
  });
});
