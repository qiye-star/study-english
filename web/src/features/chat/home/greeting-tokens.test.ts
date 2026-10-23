import { describe, expect, it } from "vitest";
import { greetingTimeline, staggerFor, tokenizeGreeting } from "./greeting-tokens";

const words = (s: string) => tokenizeGreeting(s).filter((t) => !t.space).map((t) => t.text);

describe("tokenizeGreeting", () => {
  it("splits English into words that keep their punctuation", () => {
    expect(words("Good morning, Owen! It's 10-day.")).toEqual(["Good", "morning,", "Owen!", "It's", "10-day."]);
  });

  it("splits Chinese per character and attaches punctuation to the previous one", () => {
    expect(words("早上好,今天。")).toEqual(["早", "上", "好,", "今", "天。"]);
  });

  it("handles mixed text", () => {
    expect(words("把 have gone 用对")).toEqual(["把", "have", "gone", "用", "对"]);
  });

  it("keeps whitespace as non-animated tokens and is empty for an empty string", () => {
    expect(tokenizeGreeting("a b").map((t) => t.space)).toEqual([false, true, false]);
    expect(tokenizeGreeting("")).toEqual([]);
  });

  it("marks emphasised tokens", () => {
    const tokens = tokenizeGreeting("you have *12 words* to review");
    expect(tokens.filter((t) => t.em).map((t) => t.text).filter((t) => t.trim())).toEqual(["12", "words"]);
    expect(tokens.find((t) => t.text === "review")?.em).toBe(false);
  });

  it("drops stars from an invalid line", () => {
    expect(tokenizeGreeting("a *b").map((t) => t.text).join("")).toBe("a b");
  });
});

describe("staggerFor", () => {
  it("keeps the stagger while the line fits and compresses a long one into maxSpan", () => {
    expect(staggerFor(10, 45, 1000)).toBe(45);
    expect(staggerFor(100, 45, 1000)).toBe(10);
    expect(staggerFor(100, 45)).toBe(45);
  });
});

describe("greetingTimeline", () => {
  it("follows the demo: 350 / 1350 / 2250, stats 500 ms after line 2, countdown at the last line", () => {
    expect(greetingTimeline(3, false)).toEqual({ starts: [350, 1350, 2250], statsAt: 1850, countdownAt: 2250 });
  });

  it("brings every line in within 600 ms when motion is reduced", () => {
    const t = greetingTimeline(3, true);
    expect(t.starts).toEqual([350, 600, 600]);
    expect(t.countdownAt).toBe(600);
  });
});
