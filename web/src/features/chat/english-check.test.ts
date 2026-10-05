import { describe, expect, it } from "vitest";
import { checkability, isAssessable } from "./english-check";

describe("checkability (R5)", () => {
  it.each<[string, ReturnType<typeof checkability>]>([
    ["I like it", { ok: true }],
    ["I'm fine, thanks", { ok: true }],
    ["Café is good today", { ok: true }],
    ["Hello", { ok: false, reason: "too-short" }],
    ["Hello there", { ok: false, reason: "too-short" }],
    ["我想喝咖啡", { ok: false, reason: "non-english" }],
    ["我觉得 it is good", { ok: false, reason: "non-english" }],
    ["Um, yes. 好的", { ok: false, reason: "non-english" }],
    ["...", { ok: false, reason: "empty" }],
    ["", { ok: false, reason: "empty" }],
  ])("%s", (text, expected) => expect(checkability(text)).toEqual(expected));

  it("assesses short English but not non-English or empty text", () => {
    expect(isAssessable("Hello")).toBe(true);
    expect(isAssessable("I like it")).toBe(true);
    expect(isAssessable("我想喝咖啡")).toBe(false);
    expect(isAssessable("?!")).toBe(false);
  });

  it("handles digits, emoji and whitespace as having no letters", () => {
    expect(checkability("12345 !!!")).toEqual({ ok: false, reason: "empty" });
    expect(checkability("😀😀")).toEqual({ ok: false, reason: "empty" });
    expect(checkability("  \n\t ")).toEqual({ ok: false, reason: "empty" });
    expect(checkability("I like it 😀 123")).toEqual({ ok: true });
  });

  it("applies the 80% Latin boundary over all letters", () => {
    // 4 Latin + 1 CJK = exactly 80% -> not below the threshold
    expect(checkability("a b c d 好").ok).toBe(true);
    // 3 Latin + 1 CJK = 75% -> non-english
    expect(checkability("a b c 好")).toEqual({ ok: false, reason: "non-english" });
  });

  it("is fast on very large input", () => {
    const big = "word ".repeat(25000);
    const t = Date.now();
    expect(checkability(big)).toEqual({ ok: true });
    expect(Date.now() - t).toBeLessThan(500);
  });
});
