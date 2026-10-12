import { describe, expect, it } from "vitest";
import { speechText } from "./speech-text";

/** 小而确定的随机数(mulberry32):不引入 fast-check,失败时用同一个种子能复现。 */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PARTS = ["hello", "Great", "job", "I", "never", "give", "up", "42", "x", " ", " ", "\n", "\t", ",", ".", "!", "?", ":", "(", ")", "\"", "“", "”", "'", "-", "—",
  "你好", "很好", "中文", "放弃", "。", "，", "！", "？", "：", "（", "）", "「", "」", "ありがとう", "カタカナ", "ＡＢＣ", "１２", "𠀀", "　", "々"];
const FORBIDDEN = /[　-〿぀-ヿ㐀-䶿一-鿿＀-￯\u{20000}-\u{2fa1f}]/u;
const FORBIDDEN_ALL = new RegExp(FORBIDDEN.source, "gu");
const words = (s: string) => s.match(/[A-Za-z0-9]+/g) ?? [];

describe("speechText (spec addressing §5.3)", () => {
  it("drops Chinese, kana and full-width runs and tidies what is left", () => {
    expect(speechText("Good job! 很好。")).toBe("Good job!");
    expect(speechText("你好")).toBe("");
    expect(speechText("。，！")).toBe("");
    expect(speechText("Say hi to 小明!")).toBe("Say hi to!");
    expect(speechText("Try “放弃” (give up).")).toBe("Try (give up).");
    expect(speechText("I like ラーメン and sushi")).toBe("I like and sushi");
    expect(speechText("abc中def")).toBe("abc def"); // never glues two words together
    expect(speechText("（注意）Use the past tense — 过去式")).toBe("Use the past tense");
  });

  it("returns text without CJK unchanged, byte for byte (the old speech path does not move)", () => {
    for (const s of ["plain English,  twice", "  spaced  ", "C# and 5 * 3", "", "café — naïve"]) expect(speechText(s)).toBe(s);
  });

  it("returns an empty string (so no TTS call is made) when only CJK, kana or full-width text is left", () => {
    for (const s of ["你好", "ありがとう", "カタカナ", "ＡＢＣ１２", "「」", "。，！？", "𠀀", "（注意）", "你好！ ...", "- 中文 -"]) expect(speechText(s), s).toBe("");
  });

  it("holds its properties on 3000 random mixes", () => {
    const next = rng(20261012);
    for (let i = 0; i < 3000; i++) {
      const n = Math.floor(next() * 16);
      let input = "";
      for (let j = 0; j < n; j++) input += PARTS[Math.floor(next() * PARTS.length)];
      const out = speechText(input);
      const ctx = JSON.stringify(input);
      expect(out, ctx).not.toMatch(FORBIDDEN); // no Chinese, kana or full-width character survives
      expect(speechText(out), ctx).toBe(out); // idempotent
      expect(words(out), ctx).toEqual(words(input.replace(FORBIDDEN_ALL, " "))); // every English word / number kept, in order
      if (FORBIDDEN.test(input)) {
        expect(out, ctx).toBe(out.trim());
        expect(out, ctx).not.toMatch(/\s{2}/);
        if (out) expect(out, ctx).toMatch(/[A-Za-z0-9]/); // never a punctuation-only call to TTS
      }
    }
  });
});
