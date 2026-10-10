import { describe, expect, it } from "vitest";
import { MAX_WORD_TARGET } from "~/lib/extension-points";
import { wordTargetFromLookup } from "./word-target";

const lookup = { word: "country", lemma: "country", pronunciation: "ˈkʌntri", pos: "noun", definition: "a nation", translation: "国家", contextTranslation: "" };

describe("wordTargetFromLookup (moved from vocabulary, R19)", () => {
  it("maps a lookup result exactly as vocabularyFromLookup did", () => {
    expect(wordTargetFromLookup(lookup, { text: "Country", context: "ask not what your  country can do" }))
      .toEqual({ word: "country", meaning: "noun · 国家 · a nation", example: "ask not what your country can do", source: "lookup" });
    expect(wordTargetFromLookup({ ...lookup, word: "", pos: "", definition: "" }, { text: " Hello ", context: "hello" }))
      .toEqual({ word: "Hello", meaning: "国家", example: undefined, source: "lookup" });
  });

  it("clips by code points", () => {
    const long = "𝒜".repeat(600);
    const t = wordTargetFromLookup({ ...lookup, definition: "d".repeat(2000) }, { text: "country", context: long });
    expect(Array.from(t.example ?? "")).toHaveLength(MAX_WORD_TARGET.example);
    expect(Array.from(t.meaning ?? "")).toHaveLength(MAX_WORD_TARGET.meaning);
    const w = wordTargetFromLookup({ ...lookup, word: "𝒜".repeat(150) }, { text: "x", context: "" });
    expect(Array.from(w.word)).toHaveLength(MAX_WORD_TARGET.word);
  });
});
