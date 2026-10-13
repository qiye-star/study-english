import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
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
const after = (extra: Partial<AfterAnswer> = {}): AfterAnswer => ({ info: INFO, defLang: "en", peek: false, onPeek: vi.fn(), ...extra });
const view = (q: Question, result: ChoiceResult | null, a?: AfterAnswer) =>
  render(<ChoiceQuestion question={q} result={result} onAnswer={vi.fn()} onListen={vi.fn()} after={a} />);
const rows = () => screen.getAllByTestId("choice-option");
const wordOf = (row: HTMLElement) => within(row).getByTestId("option-word").textContent;
// 用 fireEvent 而不是 userEvent.dblClick:user-event 在 mousedown 时会自己改选区,会干扰「程序化选中」的断言
const doubleTap = (row: HTMLElement) => {
  fireEvent.click(row, { detail: 1 });
  fireEvent.click(row, { detail: 2 });
};

beforeEach(() => {
  localStorage.clear();
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  void i18n.changeLanguage("en");
});

describe("ChoiceQuestion before the answer / without `after`", () => {
  it("keeps the options as buttons until there is a result", () => {
    view(meaning, null, after());
    expect(screen.getAllByRole("button").filter((b) => b.closest("li") !== null && b.getAttribute("data-state"))).toHaveLength(3);
    expect(screen.queryByTestId("choice-option")).toBeNull();
    expect(screen.queryByTestId("double-tap-hint")).toBeNull();
    expect(screen.queryByTestId("option-peek")).toBeNull();
  });

  it("leaves the learn page / spot-check rendering alone: no `after` means disabled buttons after the answer", () => {
    view(meaning, wrongPick);
    const buttons = screen.getAllByRole("button").filter((b) => b.closest("li") !== null && b.getAttribute("data-state"));
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByTestId("choice-option")).toBeNull();
  });

  it("never changes cloze, even with `after`", () => {
    view(cloze, { choice: "stop", correct: false, correctOption: "carry" }, after({ info: undefined }));
    const buttons = screen.getAllByRole("button").filter((b) => b.closest("li") !== null && b.getAttribute("data-state"));
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByTestId("choice-option")).toBeNull();
  });
});

describe("ChoiceQuestion · meaning, after the answer (spec D2)", () => {
  it("shows the English word on every row, Chinese hidden under English-only, with the right state on each", () => {
    view(meaning, wrongPick, after());
    expect(rows().map(wordOf)).toEqual(["talk", "accident", "abandon"]);
    expect(rows().map((r) => r.getAttribute("data-state"))).toEqual(["correct", "wrong", "idle"]);
    expect(screen.queryByText("n. 事故")).toBeNull(); // 中文不直接显示
    expect(screen.queryByText(OPT_TALK)).toBeNull();
    expect(screen.getByText("v. 放弃")).toBeTruthy(); // 缺口词(没有英文释义)回退成中文
    expect(rows()[1].querySelector("s")).toBeNull(); // 现在显示的是单词,不划线
  });

  it("is not a disabled button: a div with touch-action manipulation and a selectable, lookup-ready word", () => {
    view(meaning, wrongPick, after());
    for (const row of rows()) {
      expect(row.tagName).toBe("DIV");
      expect(row.className).toMatch(/\btouch-manipulation\b/);
      expect(row).toHaveAttribute("role", "button");
      expect(row).toHaveAttribute("tabindex", "0");
      const word = within(row).getByTestId("option-word");
      expect(word).toHaveAttribute("data-lookup-context");
      expect(word).toHaveAttribute("lang", "en");
      expect(word.className).toMatch(/\bselect-text\b/);
    }
    expect(screen.queryAllByRole("button").filter((b) => b.tagName === "BUTTON" && (b as HTMLButtonElement).disabled)).toHaveLength(0);
  });

  it("offers the 中 switch when some option hid its Chinese, and shows the Chinese lines when peek is on", async () => {
    const onPeek = vi.fn();
    const { rerender } = view(meaning, wrongPick, after({ onPeek }));
    await userEvent.click(screen.getByTestId("option-peek"));
    expect(onPeek).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("option-peek")).toHaveAttribute("aria-pressed", "false");
    rerender(<ChoiceQuestion question={meaning} result={wrongPick} onAnswer={vi.fn()} onListen={vi.fn()} after={after({ onPeek, peek: true })} />);
    expect(screen.getByTestId("option-peek")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("n. 事故")).toBeTruthy();
    expect(screen.getByText(OPT_TALK)).toBeTruthy();
  });

  it("has no 中 switch under 'zh' / 'both' (Chinese is already there) or when nothing was hidden", () => {
    for (const defLang of ["zh", "both"] as const) {
      const { unmount } = view(meaning, wrongPick, after({ defLang }));
      expect(screen.queryByTestId("option-peek")).toBeNull();
      expect(screen.getByText("n. 事故")).toBeTruthy();
      unmount();
    }
    view(meaning, wrongPick, after({ info: [INFO[2]] }));
    expect(screen.queryByTestId("option-peek")).toBeNull();
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
    expect(screen.queryByTestId("double-tap-hint")).toBeNull();
    expect(screen.queryByTestId("option-peek")).toBeNull();
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

  it("shows each word with a small Chinese line and part of speech, even under English-only", () => {
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
    expect(screen.getByTestId("double-tap-hint")).toBeTruthy();
  });
});

describe("ChoiceQuestion · double tap picks the word for the lookup bar (spec D4, R-A9)", () => {
  const selected = () => window.getSelection()?.toString() ?? "";

  it("selects the word of a row on a double tap (two clicks inside 300 ms)", () => {
    view(meaning, wrongPick, after());
    doubleTap(rows()[1]);
    expect(selected()).toBe("accident");
  });

  it("does nothing for a single tap or for two taps further apart than 300 ms", () => {
    const clock = vi.spyOn(performance, "now");
    view(meaning, wrongPick, after());
    clock.mockReturnValue(1000);
    fireEvent.click(rows()[1], { detail: 1 });
    expect(selected()).toBe("");
    clock.mockReturnValue(1500);
    fireEvent.click(rows()[1], { detail: 1 });
    expect(selected()).toBe("");
  });

  it("counts two taps inside the window only when they hit the same row", () => {
    const clock = vi.spyOn(performance, "now");
    view(meaning, wrongPick, after());
    clock.mockReturnValue(1000);
    fireEvent.click(rows()[0], { detail: 1 });
    clock.mockReturnValue(1100);
    fireEvent.click(rows()[1], { detail: 1 });
    expect(selected()).toBe("");
    clock.mockReturnValue(1200);
    fireEvent.click(rows()[1], { detail: 1 });
    expect(selected()).toBe("accident");
  });

  it("falls back to the native dblclick for a slow double click", () => {
    const clock = vi.spyOn(performance, "now");
    view(meaning, wrongPick, after());
    clock.mockReturnValue(1000);
    fireEvent.click(rows()[2], { detail: 1 });
    clock.mockReturnValue(1500);
    fireEvent.click(rows()[2], { detail: 2 });
    clock.mockReturnValue(1510);
    fireEvent.doubleClick(rows()[2]);
    expect(selected()).toBe("abandon");
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
    doubleTap(rows()[1]);
    expect(selected()).toBe("some text");
    elsewhere.remove();
  });

  it("does not react to a double tap before the answer (the options are still answer buttons)", async () => {
    const onAnswer = vi.fn();
    render(<ChoiceQuestion question={meaning} result={null} onAnswer={onAnswer} onListen={vi.fn()} after={after()} />);
    await userEvent.click(screen.getByRole("button", { name: /n\. 事故/ }));
    expect(onAnswer).toHaveBeenCalledWith("n. 事故");
    expect(selected()).toBe("");
  });
});

describe("ChoiceQuestion · one-time double-tap hint (R-A12)", () => {
  it("shows once after the first answered question and not on the next one", () => {
    const first = view(meaning, wrongPick, after());
    expect(screen.getByTestId("double-tap-hint")).toHaveTextContent("双击选项可查词");
    first.unmount();
    view(wordQ, { choice: "stop", correct: false, correctOption: "talk" }, after({ info: WORD_INFO }));
    expect(screen.queryByTestId("double-tap-hint")).toBeNull();
  });
});
