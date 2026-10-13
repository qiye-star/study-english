import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectWord, tokenizeSentence, wordTones, type WordScore } from "./word-tap";

describe("tokenizeSentence", () => {
  it("keeps every character and numbers the words in order", () => {
    const tokens = tokenizeSentence("Well-known, isn't it? 3 cats.");
    expect(tokens.map((t) => t.text).join("")).toBe("Well-known, isn't it? 3 cats.");
    const words = tokens.filter((t) => t.word >= 0);
    expect(words.map((t) => t.text)).toEqual(["Well-known", "isn't", "it", "3", "cats"]);
    expect(words.map((t) => t.word)).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns one gap token for text without words, nothing for empty text", () => {
    expect(tokenizeSentence("...")).toEqual([{ text: "...", word: -1 }]);
    expect(tokenizeSentence("")).toEqual([]);
  });
});

describe("wordTones (plan W2 R-SH09)", () => {
  it("aligns scored words in order, skips insertions and marks omissions and mispronunciations low", () => {
    const words: WordScore[] = [
      { word: "i", accuracyScore: 98, errorType: "None" },
      { word: "uh", accuracyScore: 10, errorType: "Insertion" },
      { word: "would", accuracyScore: 75, errorType: "None" },
      { word: "like", accuracyScore: 90, errorType: "Omission" },
      { word: "a", accuracyScore: 50, errorType: "None" },
      { word: "cup", accuracyScore: 92, errorType: "Mispronunciation" },
      { word: "coffee", accuracyScore: 88, errorType: "None" },
    ];
    expect(wordTones(tokenizeSentence("I would like a cup of coffee."), words)).toEqual(["good", "fair", "low", "low", "low", null, "good"]);
  });

  it("ignores case, apostrophes and hyphens when matching", () => {
    const words: WordScore[] = [
      { word: "isnt", accuracyScore: 95, errorType: "None" },
      { word: "well-known", accuracyScore: 60, errorType: "None" },
    ];
    expect(wordTones(tokenizeSentence("Isn't well-known"), words)).toEqual(["good", "low"]);
  });

  it("leaves every word uncoloured without a result or without a score", () => {
    expect(wordTones(tokenizeSentence("Hi there"), undefined)).toEqual([null, null]);
    expect(wordTones(tokenizeSentence("Hi"), [{ word: "hi", accuracyScore: null, errorType: null }])).toEqual([null]);
  });
});

describe("selectWord (plan W2 R-SH15)", () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });
  const mount = () => {
    document.body.innerHTML = '<p data-lookup-context><span id="a">Hello</span> <span id="b">world</span>.</p>';
    return { a: document.getElementById("a")!, b: document.getElementById("b")! };
  };

  it("selects exactly the tapped word inside its lookup context", () => {
    const { b } = mount();
    expect(selectWord(b)).toBe(true);
    const sel = document.getSelection()!;
    expect(sel.toString()).toBe("world");
    expect(sel.anchorNode).toBe(b);
    expect(b.closest("[data-lookup-context]")).not.toBeNull();
  });

  it("fires selectionchange so the global lookup layer can open", async () => {
    const { a } = mount();
    const spy = vi.fn();
    document.addEventListener("selectionchange", spy);
    try {
      selectWord(a);
      await waitFor(() => expect(spy).toHaveBeenCalled());
    } finally {
      document.removeEventListener("selectionchange", spy);
    }
  });

  it("keeps a selection the user dragged over several words", () => {
    const { a, b } = mount();
    const range = document.createRange();
    range.setStart(a.firstChild!, 0);
    range.setEnd(b.firstChild!, 3);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(selectWord(b)).toBe(false);
    expect(sel.toString()).toBe("Hello wor");
  });
});
