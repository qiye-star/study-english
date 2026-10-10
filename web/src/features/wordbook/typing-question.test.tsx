import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { TypingQuestion } from "./typing-question";
import type { Question } from "./wordbook-api";

const SPELL: Question = { key: "accept", qtype: "spell", prompt: { meaning: "v. 接受；承认", us: "əkˈsɛpt" }, options: null, length: 6 };

beforeEach(() => { void i18n.changeLanguage("zh-CN"); });
afterEach(() => { void i18n.changeLanguage("en"); });

describe("TypingQuestion", () => {
  it("submits typed text with the hint flag and disables mobile autocorrect", () => {
    const onSubmit = vi.fn();
    render(<TypingQuestion question={SPELL} onSubmit={onSubmit} result={null} onListen={vi.fn()} />);
    expect(screen.getByText("v. 接受；承认")).toBeTruthy();
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("enterkeyhint", "done");
    fireEvent.click(screen.getByRole("button", { name: "首字母" }));
    expect((input as HTMLInputElement).value).toBe("a");
    fireEvent.change(input, { target: { value: "acept" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith({ typed: "acept", hinted: true });
  });

  it("ignores the Enter that commits an IME composition on Safari (keyCode 229, isComposing false)", () => {
    const onSubmit = vi.fn();
    render(<TypingQuestion question={SPELL} onSubmit={onSubmit} result={null} onListen={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "acc" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit an empty answer, and the submit button sends without a hint", () => {
    const onSubmit = vi.fn();
    render(<TypingQuestion question={SPELL} onSubmit={onSubmit} result={null} onListen={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: " accept " } });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    expect(onSubmit).toHaveBeenCalledWith({ typed: "accept", hinted: false });
  });

  it("never shows the word for dictation and plays it once on first appearance", () => {
    const onListen = vi.fn();
    const { rerender } = render(<TypingQuestion question={{ ...SPELL, qtype: "dictation", prompt: { word: "accept" } }} onSubmit={vi.fn()} result={null} onListen={onListen} />);
    expect(screen.queryByText("accept")).toBeNull();
    expect(screen.getByRole("button", { name: "播放读音" })).toBeTruthy();
    expect(onListen).toHaveBeenCalledTimes(1);
    expect(onListen).toHaveBeenCalledWith(expect.any(String), "accept");
    rerender(<TypingQuestion question={{ ...SPELL, qtype: "dictation", prompt: { word: "accept" } }} onSubmit={vi.fn()} result={null} onListen={onListen} />);
    expect(onListen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "播放读音" }));
    expect(onListen).toHaveBeenCalledTimes(2);
  });

  it("shows the outcome badge, the letter diff and the correct spelling once graded", () => {
    render(<TypingQuestion question={SPELL} onSubmit={vi.fn()} onListen={vi.fn()} result={{
      correct: false, outcome: "typo", grade: "hard", expected: "accept", correctOption: null, applied: true, item: null,
      rating: null, spotCheck: false, check: null,
      diff: [{ op: "eq", a: "a", b: "a" }, { op: "eq", a: "c", b: "c" }, { op: "del", a: "c", b: "" }, { op: "eq", a: "e", b: "e" }, { op: "eq", a: "p", b: "p" }, { op: "eq", a: "t", b: "t" }],
    }} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
    expect(screen.getByTestId("outcome-badge")).toHaveTextContent("小笔误");
    expect(screen.getByTestId("outcome-badge")).toHaveAttribute("data-outcome", "typo");
    expect(screen.getByRole("img", { name: "正确拼写 accept" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "提交" })).toBeNull();
  });

  it("shows a neutral badge for a wrong answer", () => {
    render(<TypingQuestion question={SPELL} onSubmit={vi.fn()} onListen={vi.fn()} result={{
      correct: false, outcome: "wrong", grade: "forgot", expected: "accept", correctOption: null, applied: true, item: null, diff: null,
      rating: null, spotCheck: false, check: null,
    }} />);
    expect(screen.getByTestId("outcome-badge")).toHaveTextContent("错误");
    expect(screen.getByTestId("typing-expected")).toHaveTextContent("正确拼写 accept");
  });
});
