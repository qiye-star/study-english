import { describe, expect, it } from "vitest";
import { mayHaveMixedVoices, wordOverlap } from "./mixed-voices";

describe("mixed voices hint (plan R10)", () => {
  it("measures how much of the transcript the assessment heard", () => {
    expect(wordOverlap("I want a coffee, please.", ["i", "want", "a", "coffee", "please"])).toBe(1);
    expect(wordOverlap("I want a coffee please", ["the", "bus", "is", "late", "coffee"])).toBe(0.2);
    expect(wordOverlap("", ["x"])).toBe(1);
  });
  it("handles empty and punctuation-only input", () => {
    expect(wordOverlap("   ", ["x"])).toBe(1);
    expect(wordOverlap("?!...", ["x"])).toBe(1);
    expect(wordOverlap("hello", [])).toBe(0);
    expect(wordOverlap("hello", [""])).toBe(0);
  });
  it("ignores case, punctuation and diacritics", () => {
    expect(wordOverlap("Café, CAFE! Naïve.", ["cafe", "naive"])).toBe(1);
    expect(wordOverlap("Don't stop.", ["DON'T", "Stop"])).toBe(1);
    expect(wordOverlap("well-known fact", ["well", "known", "fact"])).toBe(1);
  });
  it("counts repeated transcript words each time", () => {
    expect(wordOverlap("no no no yes", ["no"])).toBe(0.75);
    expect(wordOverlap("no yes", ["no", "no", "no"])).toBe(0.5);
  });
  it("hints only for a low score with a low overlap", () => {
    const heard = ["the", "bus", "is", "late"];
    expect(mayHaveMixedVoices(35, "I want a coffee please", heard)).toBe(true);
    expect(mayHaveMixedVoices(55, "I want a coffee please", heard)).toBe(false);
    expect(mayHaveMixedVoices(35, "the bus is late", heard)).toBe(false);
    expect(mayHaveMixedVoices(null, "I want a coffee please", heard)).toBe(false);
    expect(mayHaveMixedVoices(undefined, "I want a coffee please", heard)).toBe(false);
  });
  it("uses strict thresholds (score 40 and overlap 0.5 do not hint)", () => {
    expect(mayHaveMixedVoices(40, "I want a coffee please", ["the"])).toBe(false);
    expect(mayHaveMixedVoices(39.9, "a b", ["a"])).toBe(false);
    expect(mayHaveMixedVoices(39.9, "a b c", ["a"])).toBe(true);
    expect(mayHaveMixedVoices(NaN, "a b c", ["z"])).toBe(false);
  });
});
