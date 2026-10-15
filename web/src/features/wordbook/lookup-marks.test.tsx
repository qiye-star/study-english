import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { DEFS_EN, card } from "./test-fixtures";
import { WordCardView, WordRecap } from "./word-card";
import type { Card } from "./wordbook-api";

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
