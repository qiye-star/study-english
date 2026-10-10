import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChoiceQuestion, correctOptionOf } from "./choice-question";
import type { Question } from "./wordbook-api";

describe("ChoiceQuestion prompt (review m6)", () => {
  it("lets a long headword shrink and wrap instead of overflowing a 375 px screen", () => {
    const long: Question = { key: "incomprehensibility", qtype: "meaning", prompt: { word: "incomprehensibility" }, options: ["a", "b"], length: null };
    render(createElement(ChoiceQuestion, { question: long, onAnswer: vi.fn(), result: null, onListen: vi.fn() }));
    const word = screen.getByTestId("question-word");
    expect(word.className).toMatch(/\bmin-w-0\b/);
    expect(word.className).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(word.className).toMatch(/text-\[26px\]/);
  });
});

const meaning: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk" }, options: ["n. 事故", "v. 说话；谈话；n. 交谈", "v. 放弃"], length: null };

describe("correctOptionOf (Ruling Z-e: the server names the correct option)", () => {
  it("uses the server's correct_option verbatim", () => {
    expect(correctOptionOf(meaning, { correctOption: "v. 说话；谈话；n. 交谈" })).toBe("v. 说话；谈话；n. 交谈");
  });

  it("does not guess from the headword or rebuild the meaning line", () => {
    expect(correctOptionOf(meaning, { correctOption: null })).toBeNull();
    expect(correctOptionOf(meaning, { correctOption: "something else" })).toBeNull();
  });
});
