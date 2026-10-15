import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { DEFS_EN, card } from "./test-fixtures";
import { ChoiceQuestion } from "./choice-question";
import { WordCardView, WordRecap } from "./word-card";
import type { Card, OptionInfo, Question } from "./wordbook-api";

const TALK = { ...card("talk", { senses: [{ pos: "v", text: "说话；谈话" }], phrases: [{ en: "talk about", zh: "谈论" }] }), defsEn: DEFS_EN } as unknown as Card;
const marked = (el: Element | null) => el !== null && el.closest("[data-lookup-context]") !== null;
const exampleP = () => screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "They talk a lot.");

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("wordbook card English text is lookup-able (plan 2026-10-15 R-M2)", () => {
  it("marks the headword, each English definition, the example and the phrases on an open card", () => {
    renderWithProviders(<WordCardView card={TALK} defLang="both" phrasesOpen />);
    expect(marked(screen.getByRole("heading", { level: 2 }))).toBe(true);
    for (const li of within(screen.getByTestId("word-defs-en")).getAllByRole("listitem")) expect(li).toHaveAttribute("data-lookup-context");
    expect(marked(exampleP())).toBe(true);
    expect(marked(screen.getByText("talk about"))).toBe(true);
  });

  it("leaves the Chinese lines unmarked", () => {
    renderWithProviders(<WordCardView card={TALK} defLang="both" phrasesOpen />);
    expect(marked(screen.getByText("说话；谈话"))).toBe(false);
    expect(marked(screen.getByText("谈论"))).toBe(false);
    expect(marked(screen.getByText("他们常常talk。"))).toBe(false);
  });

  it("does not mark a covered card's headword (no peeking past the cover, R-M3)", () => {
    renderWithProviders(<WordCardView card={TALK} covered />);
    expect(marked(screen.getByRole("heading", { level: 2 }))).toBe(false);
  });

  it("marks the recap word and example", () => {
    renderWithProviders(<WordRecap card={TALK} />);
    const recap = screen.getByTestId("word-recap");
    expect(marked(within(recap).getByText((_, el) => el?.tagName === "B" && el.textContent === "talk"))).toBe(true);
    expect(marked(within(recap).getByText((_, el) => el?.tagName === "P" && el.textContent === "They talk a lot."))).toBe(true);
  });
});

const meaningQ: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk", us: "tɔk" }, options: ["v. 说话", "n. 事故"], length: null };
const clozeQ: Question = { key: "carry", qtype: "cloze", prompt: { sentence: "He _____ it.", zh: "他搬它。" }, options: ["stop", "carry"], length: null };
const INFO: OptionInfo[] = [
  { option: "v. 说话", word: "talk", defsZh: [{ pos: "v", text: "说话" }], defsEn: [] },
  { option: "n. 事故", word: "accident", defsZh: [{ pos: "n", text: "事故" }], defsEn: [] },
];

describe("wordbook quiz prompts become lookup-able only after the answer (R-M3)", () => {
  it("the meaning question's word", () => {
    const { rerender } = render(<ChoiceQuestion question={meaningQ} result={null} onAnswer={vi.fn()} />);
    expect(marked(screen.getByTestId("question-word"))).toBe(false);
    rerender(<ChoiceQuestion question={meaningQ} result={{ choice: "n. 事故", correct: false, correctOption: "v. 说话" }} onAnswer={vi.fn()} />);
    expect(marked(screen.getByTestId("question-word"))).toBe(true);
  });

  it("the cloze sentence", () => {
    const { rerender, container } = render(<ChoiceQuestion question={clozeQ} result={null} onAnswer={vi.fn()} />);
    const sentence = () => container.querySelector('p[lang="en"]')!;
    expect(marked(sentence())).toBe(false);
    rerender(<ChoiceQuestion question={clozeQ} result={{ choice: "stop", correct: false, correctOption: "carry" }} onAnswer={vi.fn()} />);
    expect(marked(sentence())).toBe(true);
  });

  it("answered option rows own their long-press, so the global recogniser skips them (R-L6)", () => {
    render(<ChoiceQuestion question={meaningQ} result={{ choice: "n. 事故", correct: false, correctOption: "v. 说话" }} onAnswer={vi.fn()} after={{ info: INFO }} />);
    for (const row of screen.getAllByTestId("choice-option")) expect(row).toHaveAttribute("data-lookup-press", "own");
  });
});
