import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { WordSpellQuestion } from "./word-spell-question";
import type { FreeItem } from "../wordbook-api";

const ITEM = {
  bookId: "junior",
  card: { key: "talk", word: "talk", us: "tɔːk", uk: "", senses: [{ pos: "v", text: "说话" }], phrases: [], examples: [], defsEn: [] },
  question: { key: "talk", qtype: "spell", prompt: { meaning: "v. 说话；谈话", us: "tɔːk" }, options: null, length: 4 },
} as unknown as FreeItem;

const speaker = () => ({ available: true, loading: false, listen: vi.fn(), active: null as string | null, prime: vi.fn(), stop: vi.fn() });

type Props = Parameters<typeof WordSpellQuestion>[0];

function setup(over: Partial<Props> = {}) {
  const props: Props = { item: ITEM, mode: "meaning" as const, result: null, busy: false, onSubmit: vi.fn(), speaker: speaker(), ...over };
  render(<WordSpellQuestion {...props} />);
  return props;
}

const frame = () => screen.getByTestId("word-spell-frame");
const input = () => screen.getByRole("textbox");

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  localStorage.setItem("enjoy-web.wordbook.prefs", JSON.stringify({ wordSpellPeekHintSeen: true }));
  void i18n.changeLanguage("zh-CN");
});

describe("WordSpellQuestion (看中文拼英文)", () => {
  it("shows the Chinese meaning with a speaker button next to it, and no phonetic", () => {
    const s = setup();
    expect(screen.getByText("v. 说话；谈话")).toBeTruthy();
    expect(screen.queryByText("tɔːk")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "播放读音" }));
    expect(s.speaker.listen).toHaveBeenCalledWith(expect.stringMatching(/^talk:q/), "talk", "us");
  });

  it("shows the word when the frame itself is pressed, not when the input is", () => {
    setup();
    fireEvent.pointerDown(input());
    expect(screen.queryByTestId("word-spell-peek")).toBeNull();
    fireEvent.pointerDown(frame());
    expect(screen.getByTestId("word-spell-peek")).toHaveTextContent("talk");
    expect(screen.getByTestId("word-spell-peek")).not.toHaveAttribute("data-lookup-context");
  });

  it("does not move focus or the keyboard when the frame is pressed", () => {
    setup();
    expect(fireEvent.mouseDown(frame())).toBe(false);
  });

  it("a touch on the input never peeks; the big visible button does (mobile)", () => {
    setup();
    fireEvent.pointerDown(input(), { pointerType: "touch" });
    fireEvent.touchStart(input());
    expect(screen.queryByTestId("word-spell-peek")).toBeNull();
    const btn = screen.getByTestId("word-spell-peek-btn");
    expect(btn.className).toContain("h-11");
    fireEvent.click(btn);
    expect(screen.getByTestId("word-spell-peek")).toHaveTextContent("talk");
  });

  it("the visible eye button shows the word too", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "显示单词" }));
    expect(screen.getByTestId("word-spell-peek")).toHaveTextContent("talk");
  });

  it("hides the peeked word as soon as typing starts and can be shown again", () => {
    setup();
    fireEvent.pointerDown(frame());
    fireEvent.change(input(), { target: { value: "t" } });
    expect(screen.queryByTestId("word-spell-peek")).toBeNull();
    fireEvent.pointerDown(frame());
    expect(screen.getByTestId("word-spell-peek")).toBeTruthy();
  });

  it("hides on IME composition start as well", () => {
    setup();
    fireEvent.pointerDown(frame());
    fireEvent.compositionStart(input());
    expect(screen.queryByTestId("word-spell-peek")).toBeNull();
  });

  it("submits hinted:true once the word was looked at, and false otherwise", () => {
    const first = setup();
    fireEvent.change(input(), { target: { value: "talk" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(first.onSubmit).toHaveBeenLastCalledWith({ typed: "talk", hinted: false });
  });

  it("a peek counts as a hint even after the word is hidden again", () => {
    const s = setup();
    fireEvent.pointerDown(frame());
    fireEvent.change(input(), { target: { value: "tak" } });
    fireEvent.change(input(), { target: { value: "talk" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(s.onSubmit).toHaveBeenLastCalledWith({ typed: "talk", hinted: true });
  });

  it("after the answer shows the badge, the diff and the word as lookup context", () => {
    setup({ result: { correct: false, outcome: "typo", grade: "fuzzy", expected: "talk", correctOption: null, diff: [], item: null, applied: true, rating: null, spotCheck: false, check: null } as never });
    expect(screen.getByTestId("outcome-badge")).toHaveAttribute("data-outcome", "typo");
    expect(screen.getByTestId("word-spell-expected")).toHaveTextContent("talk");
    expect(screen.getByTestId("word-spell-expected").querySelector("[data-lookup-context]")).not.toBeNull();
  });

  it("after a wrong answer: replay button, and a 看过单词 mark when the word was peeked", () => {
    const wrong = { correct: false, outcome: "wrong", grade: "forgot", expected: "talk", correctOption: null, diff: [], item: null, applied: true, rating: null, spotCheck: false, check: null } as never;
    const props = { item: ITEM, mode: "meaning" as const, result: null, busy: false, onSubmit: vi.fn(), speaker: speaker() };
    const { rerender } = render(<WordSpellQuestion {...props} />);
    fireEvent.click(screen.getByTestId("word-spell-peek-btn"));
    rerender(<WordSpellQuestion {...props} result={wrong} />);
    expect(screen.getByTestId("word-spell-replay")).toBeTruthy();
    expect(screen.getByTestId("word-spell-peeked")).toHaveTextContent("看过单词");
  });

  it("shows the first-time peek hint once, then never again", () => {
    localStorage.setItem("enjoy-web.wordbook.prefs", JSON.stringify({ wordSpellPeekHintSeen: false }));
    const { unmount } = render(<WordSpellQuestion item={ITEM} mode="meaning" result={null} busy={false} onSubmit={vi.fn()} speaker={speaker()} />);
    expect(screen.getByTestId("word-spell-peek-hint")).toBeTruthy();
    unmount();
    render(<WordSpellQuestion item={ITEM} mode="meaning" result={null} busy={false} onSubmit={vi.fn()} speaker={speaker()} />);
    expect(screen.queryByTestId("word-spell-peek-hint")).toBeNull();
  });
});

describe("WordSpellQuestion (单词听写)", () => {
  it("replay sends a new play id every time, so the TTS player plays again instead of stopping", () => {
    const s = setup({ mode: "dictation" });
    const button = screen.getByRole("button", { name: "播放读音" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(s.speaker.listen).toHaveBeenCalledTimes(2);
    const [first, second] = (s.speaker.listen as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(first).not.toBe(second);
    expect(s.speaker.listen).toHaveBeenNthCalledWith(2, expect.any(String), "talk", "us");
  });

  it("never shows the word, the frame peek or the eye button", () => {
    setup({ mode: "dictation" });
    expect(screen.queryByText("talk")).toBeNull();
    expect(screen.queryByRole("button", { name: "显示单词" })).toBeNull();
    fireEvent.pointerDown(frame());
    expect(screen.queryByTestId("word-spell-peek")).toBeNull();
  });
});
