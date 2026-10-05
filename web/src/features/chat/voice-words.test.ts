import { describe, expect, it } from "vitest";
import { isPoorWord, markTranscript, poorWords } from "./voice-words";

const w = (word: string, accuracyScore: number | null, errorType: string | null = "None") => ({ word, accuracyScore, errorType });

describe("voice words", () => {
  it("classifies poor words", () => {
    expect(isPoorWord(w("a", 95))).toBe(false);
    expect(isPoorWord(w("a", 59))).toBe(true);
    expect(isPoorWord(w("a", 60))).toBe(false);
    expect(isPoorWord(w("a", 90, "Mispronunciation"))).toBe(true);
    expect(isPoorWord(w("a", 0, "Omission"))).toBe(true);
    expect(isPoorWord(w("a", 0, "Insertion"))).toBe(false);
    expect(isPoorWord(w("a", null))).toBe(false);
    expect(isPoorWord(w("a", 30, null))).toBe(true);
  });

  it("marks poor words in the transcript, keeping punctuation and spacing", () => {
    const words = [w("hello", 100), w("nice", 98), w("to", 99), w("meet", 40, "Mispronunciation"), w("you", 100)];
    expect(markTranscript("Hello, nice to meet you.", words)).toEqual([
      { text: "Hello, nice to ", poor: false }, { text: "meet", poor: true }, { text: " you.", poor: false },
    ]);
  });

  it("skips inserted words, matches contractions and tolerates unmatched tokens", () => {
    const words = [w("um", 0, "Insertion"), w("i'm", 30), w("very", 95), w("tired", 50)];
    expect(markTranscript("I'm so very tired", words)).toEqual([
      { text: "I'm", poor: true }, { text: " so very ", poor: false }, { text: "tired", poor: true },
    ]);
    expect(markTranscript("No scores here", undefined)).toEqual([{ text: "No scores here", poor: false }]);
  });

  it("handles empty text and curly apostrophes", () => {
    expect(markTranscript("", [w("a", 10)])).toEqual([{ text: "", poor: false }]);
    expect(markTranscript("don’t go", [w("don't", 20), w("go", 99)])).toEqual([
      { text: "don’t", poor: true }, { text: " go", poor: false },
    ]);
  });

  it("lists distinct poor words", () => {
    expect(poorWords([w("think", 40), w("Think", 30), w("ok", 99), w("three", 10)])).toEqual(["think", "three"]);
    expect(poorWords(undefined)).toEqual([]);
    expect(poorWords([w("a", 1), w("b", 1), w("c", 1)], 2)).toEqual(["a", "b"]);
  });
});
