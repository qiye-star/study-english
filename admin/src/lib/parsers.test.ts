import { describe, expect, it } from "vitest";
import { parseGrammar, parseWords } from "./parsers";

describe("parseGrammar", () => {
  it("reads the user-app shape, also when wrapped in {status,result}", () => {
    const body = { hasErrors: true, corrected: "I went home.", errors: [{ original: "goed", corrected: "went", category: "tense", explanation: "past" }] };
    expect(parseGrammar(body)?.errors[0].corrected).toBe("went");
    expect(parseGrammar({ status: "done", result: body })?.corrected).toBe("I went home.");
  });
  it("accepts snake_case and derives hasErrors", () => {
    expect(parseGrammar({ has_errors: false, corrected: "ok", errors: [] })?.hasErrors).toBe(false);
    expect(parseGrammar({ corrected: "x", errors: [{ original: "a", corrected: "b" }] })?.hasErrors).toBe(true);
  });
  it("returns null for unknown shapes", () => {
    expect(parseGrammar({ foo: 1 })).toBeNull();
    expect(parseGrammar({ errors: ["x"] })).toBeNull();
  });
});

describe("parseWords", () => {
  it("reads Azure-shaped detail_result words", () => {
    const result = {
      detail_result: {
        words: [
          {
            word: "hello",
            pronunciation_assessment: { accuracy_score: 91, error_type: "None" },
            phonemes: [{ phoneme: "h", pronunciation_assessment: { accuracy_score: 90 } }],
          },
          { word: "world", pronunciation_assessment: { accuracy_score: 40, error_type: "Mispronunciation" } },
        ],
      },
    };
    const words = parseWords(result)!;
    expect(words.map((w) => w.score)).toEqual([91, 40]);
    expect(words[1].errorType).toBe("Mispronunciation");
    expect(words[0].phonemes[0]).toEqual({ phoneme: "h", score: 90 });
  });
  it("returns null when there are no words", () => {
    expect(parseWords({})).toBeNull();
    expect(parseWords(null)).toBeNull();
  });
});
