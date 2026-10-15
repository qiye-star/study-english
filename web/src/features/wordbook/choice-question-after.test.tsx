import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { setLiquid } from "~/test/glass";
import { ChoiceQuestion, type AfterAnswer, type ChoiceResult } from "./choice-question";
import type { OptionInfo, Question } from "./wordbook-api";

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
    expect(screen.queryByTestId("tap-lookup-hint")).toBeNull();
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
    expect(screen.getByTestId("tap-lookup-hint")).toBeTruthy();
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

  it("is not a disabled button: a non-interactive div with touch-action manipulation and a selectable, tap-lookup-ready word", () => {
    view(meaning, wrongPick, after());
    for (const row of rows()) {
      expect(row.tagName).toBe("DIV");
      expect(row.className).toMatch(/\btouch-manipulation\b/);
      expect(row.className).not.toMatch(/\bselect-none\b/);
      expect(row.className).not.toContain("touch-callout");
      expect(row).not.toHaveAttribute("role");
      expect(row).not.toHaveAttribute("tabindex");
      expect(row).not.toHaveAttribute("data-lookup-press");
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
    expect(screen.queryByTestId("tap-lookup-hint")).toBeNull();
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
    expect(screen.getByTestId("tap-lookup-hint")).toBeTruthy();
  });
});

describe("ChoiceQuestion · no own long-press any more (tap-to-lookup is global)", () => {
  beforeEach(() => vi.useFakeTimers());

  it("holding a row selects nothing, the click is not swallowed and the native context menu is left alone", () => {
    const outer = vi.fn();
    render(<div onClick={outer}><ChoiceQuestion question={meaning} result={wrongPick} onAnswer={vi.fn()} onListen={vi.fn()} after={after()} /></div>);
    fireEvent.pointerDown(rows()[1], { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10, button: 0, isPrimary: true });
    vi.advanceTimersByTime(600);
    expect(selected()).toBe("");
    fireEvent.pointerUp(rows()[1], { pointerId: 1 });
    fireEvent.click(rows()[1], { detail: 1 });
    expect(outer).toHaveBeenCalledTimes(1);
    expect(fireEvent.contextMenu(rows()[1])).toBe(true);
  });

  it("does not react to the keyboard either: the rows are not buttons", () => {
    view(meaning, wrongPick, after());
    fireEvent.keyDown(rows()[0], { key: "Enter" });
    fireEvent.click(rows()[2], { detail: 0 });
    expect(selected()).toBe("");
  });

  it("before the answer the options are still plain answer buttons", () => {
    const onAnswer = vi.fn();
    render(<ChoiceQuestion question={meaning} result={null} onAnswer={onAnswer} onListen={vi.fn()} after={after()} />);
    fireEvent.click(screen.getByRole("button", { name: /n\. 事故/ }));
    expect(onAnswer).toHaveBeenCalledWith("n. 事故");
  });
});

describe("ChoiceQuestion · one-time tap-lookup hint", () => {
  it("shows once after the first answered question and not on the next one", () => {
    const first = view(meaning, wrongPick, after());
    expect(screen.getByTestId("tap-lookup-hint")).toHaveTextContent("点一下单词会出现横线,再点一次查词");
    first.unmount();
    view(wordQ, { choice: "stop", correct: false, correctOption: "talk" }, after({ info: WORD_INFO }));
    expect(screen.queryByTestId("tap-lookup-hint")).toBeNull();
  });
});

describe("ChoiceQuestion · liquid skin (plan 2026-10-15-liquid-glass R-L9-3)", () => {
  afterEach(() => setLiquid(false));
  it("correct = ink ring + green mark, wrong = red mark", () => {
    setLiquid(true);
    view(meaning, wrongPick, after());
    const correct = rows().find((r) => r.dataset.state === "correct")!;
    const wrong = rows().find((r) => r.dataset.state === "wrong")!;
    expect(correct.className).toContain("liquid:shadow-[inset_0_0_0_1.5px_rgb(var(--ink)),var(--mat-sh-1)]");
    expect(correct.querySelector(".text-green [class*='liquid:inline']")).not.toBeNull();
    expect(wrong.querySelector(".liquid\\:text-red")).not.toBeNull();
  });
});
