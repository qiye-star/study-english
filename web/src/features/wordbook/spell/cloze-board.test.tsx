import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import type { BlankResult, ClozeSet } from "../wordbook-api";
import { ClozeBoard } from "./cloze-board";
import { initCloze, type ClozeState } from "./cloze-engine";
import { readPrefs, writePrefs, WORDBOOK_PREFS_KEY } from "./prefs";

const SET: ClozeSet = {
  setId: "abc123abc123",
  lines: [
    { key: "talk", sentenceId: "1".repeat(16), zh: "经过一次长谈后,我们决定离婚。", segments: [{ t: "text", v: "After a long " }, { t: "blank", i: 0, len: 4, form: "talk" }, { t: "text", v: ", we decided on divorce." }] },
    { key: "used to", sentenceId: "2".repeat(16), zh: "我以前住在海边的一个小镇。", segments: [{ t: "text", v: "I " }, { t: "blank", i: 1, len: 4, form: "used" }, { t: "text", v: " " }, { t: "blank", i: 2, len: 2, form: "to" }, { t: "text", v: " live in a small town by the sea." }] },
  ],
};

const state = (patch: Partial<ClozeState> = {}): ClozeState => ({ ...initCloze(3), ...patch });

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); localStorage.removeItem(WORDBOOK_PREFS_KEY); void i18n.changeLanguage("en"); });

describe("ClozeBoard", () => {
  it("renders numbered sentences with read-only textbox blanks, the active one marked", () => {
    render(<ClozeBoard set={SET} state={state({ values: ["tal", "", ""] })} showLength={false} showZh={false} onFocusBlank={vi.fn()} />);
    const blanks = screen.getAllByRole("textbox");
    expect(blanks).toHaveLength(3);
    for (const b of blanks) expect(b).toHaveAttribute("aria-readonly", "true");
    expect(blanks[1]).toHaveAttribute("aria-label", "第 2 空,共 3 空,点按输入");
    expect(blanks[0]).toHaveAttribute("aria-current", "true");
    expect(blanks[0].className).toMatch(/border-blue/);
    expect(blanks[1]).not.toHaveAttribute("aria-current");
    expect(blanks[0].textContent).toBe("tal");
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/After a long/)).toBeInTheDocument();
    expect(screen.queryByText("经过一次长谈后,我们决定离婚。")).toBeNull();
  });

  it("a long value may wrap inside its blank instead of widening the card (review m3)", () => {
    render(<ClozeBoard set={SET} state={state({ values: ["x".repeat(32), "", ""] })} showLength={false} showZh={false} onFocusBlank={vi.fn()} />);
    const blank = screen.getAllByRole("textbox")[0];
    expect(blank.className).toMatch(/\bmax-w-full\b/);
    expect(blank.className).toMatch(/\bbreak-all\b/);
    expect(blank.className).toMatch(/\bwhitespace-normal\b/);
  });

  it("shows letter cells only when showLength is on, and only for empty blanks", () => {
    const { rerender } = render(<ClozeBoard set={SET} state={state()} showLength={false} showZh={false} onFocusBlank={vi.fn()} />);
    expect(screen.queryAllByTestId("letter-cell")).toHaveLength(0);
    rerender(<ClozeBoard set={SET} state={state({ values: ["", "used", ""] })} showLength showZh={false} onFocusBlank={vi.fn()} />);
    const [first, second, third] = screen.getAllByRole("textbox");
    expect(within(first).getAllByTestId("letter-cell")).toHaveLength(4);
    expect(within(second).queryAllByTestId("letter-cell")).toHaveLength(0);
    expect(within(third).getAllByTestId("letter-cell")).toHaveLength(2);
  });

  it("tapping a blank asks to focus it; translations show on demand", () => {
    const onFocusBlank = vi.fn();
    render(<ClozeBoard set={SET} state={state()} showLength={false} showZh onFocusBlank={onFocusBlank} />);
    fireEvent.click(screen.getAllByRole("textbox")[2]);
    expect(onFocusBlank).toHaveBeenCalledWith(2);
    expect(screen.getByText("我以前住在海边的一个小镇。")).toBeInTheDocument();
  });

  it("after submit shows an icon + text outcome badge per blank and stops taking focus", () => {
    const onFocusBlank = vi.fn();
    const results: BlankResult[] = [
      { i: 0, outcome: "typo", credit: 50, typed: "tlak", expected: "talk", diff: [] },
      { i: 1, outcome: "inflection", credit: 50, typed: "use", expected: "used", diff: [] },
      { i: 2, outcome: "wrong", credit: 0, typed: "", expected: "to", diff: [] },
    ];
    render(<ClozeBoard set={SET} state={state({ values: ["tlak", "use", ""] })} showLength={false} showZh={false} onFocusBlank={onFocusBlank} results={results} />);
    const blanks = screen.getAllByRole("textbox");
    expect(within(blanks[0].parentElement!).getByText("小笔误")).toBeInTheDocument();
    expect(within(blanks[1].parentElement!).getByText("词形不对")).toBeInTheDocument();
    expect(within(blanks[2].parentElement!).getByText("错误")).toBeInTheDocument();
    expect(blanks[0]).not.toHaveAttribute("aria-current");
    fireEvent.click(blanks[0]);
    expect(onFocusBlank).not.toHaveBeenCalled();
    render(<ClozeBoard set={SET} state={state({ values: ["talk", "used", "to"] })} showLength={false} showZh={false} onFocusBlank={vi.fn()}
      results={[{ i: 0, outcome: "correct", credit: 100, typed: "talk", expected: "talk", diff: [] }]} />);
    expect(screen.getByText("正确")).toBeInTheDocument();
  });
});

describe("spell prefs", () => {
  it("defaults to hidden letter counts, round-trips and survives garbage", () => {
    expect(readPrefs()).toEqual({ showLength: false });
    writePrefs({ showLength: true });
    expect(readPrefs()).toEqual({ showLength: true });
    localStorage.setItem(WORDBOOK_PREFS_KEY, "not json");
    expect(readPrefs()).toEqual({ showLength: false });
  });
});
