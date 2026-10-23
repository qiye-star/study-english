import { describe, expect, it } from "vitest";
import { activeWordAt, estimateWordTimes, wordStates } from "./karaoke";

describe("karaoke word timing (plan L5 W9; a linear estimate, not real word times)", () => {
  it("splits the sentence by letter count and covers the whole sentence", () => {
    const spans = estimateWordTimes(["go", "home"], 1000, 2000);
    expect(spans).toEqual([
      { word: "go", startMs: 1000, endMs: 1333 },
      { word: "home", startMs: 1333, endMs: 2000 },
    ]);
    expect(spans[spans.length - 1].endMs).toBe(2000);
  });

  it("punctuation does not count as a letter (weight is at least 1)", () => {
    const spans = estimateWordTimes(["ok", "!", "yes"], 0, 500);
    // 权重 2 : 1 : 3(标点算 1),共 500 ms:167 / 83 / 250
    expect(spans.map((s) => s.endMs - s.startMs)).toEqual([167, 83, 250]);
  });

  it("no words or no time gives no spans that run backwards", () => {
    expect(estimateWordTimes([], 0, 1000)).toEqual([]);
    expect(estimateWordTimes(["a"], 500, 400)[0]).toMatchObject({ startMs: 500, endMs: 500 });
  });

  it("the active word is the one whose span contains the time, or -1 before and after", () => {
    const spans = estimateWordTimes(["go", "home"], 1000, 2000);
    expect(activeWordAt(spans, 900)).toBe(-1);
    expect(activeWordAt(spans, 1000)).toBe(0);
    expect(activeWordAt(spans, 1500)).toBe(1);
    expect(activeWordAt(spans, 2000)).toBe(-1);
  });

  it("word states: past, active, future; with reduced motion the whole sentence lights up at once", () => {
    const spans = estimateWordTimes(["go", "home"], 1000, 2000);
    expect(wordStates(spans, 1500, false)).toEqual(["past", "active"]);
    expect(wordStates(spans, 900, false)).toEqual(["future", "future"]);
    expect(wordStates(spans, 1500, true)).toEqual(["active", "active"]);
    expect(wordStates(spans, 900, true)).toEqual(["future", "future"]);
  });
});
