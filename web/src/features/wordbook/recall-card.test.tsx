import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { DEFS_EN, card } from "./test-fixtures";
import { RecallCard } from "./recall-card";
import type { Card, Question } from "./wordbook-api";

const CARD = { ...card("talk", { senses: [{ pos: "v", text: "说话；谈话" }] }), defsEn: DEFS_EN } as unknown as Card;
const QUESTION: Question = { key: "talk", qtype: "recall", prompt: { word: "talk", us: "tɔk" }, options: null, length: null };

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("RecallCard back (review quick recall / browse)", () => {
  it("front has no meaning at all, in any mode", () => {
    renderWithProviders(<RecallCard question={QUESTION} card={CARD} face="front" rating={null} defLang="both" />);
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
    expect(screen.getByTestId("recall-card")).not.toHaveTextContent("说话；谈话");
  });

  it.each([
    ["both", true, true],
    ["zh", true, false],
    ["en", false, true],
  ] as const)("back with defLang=%s shows zh=%s en=%s", (mode, zh, en) => {
    renderWithProviders(<RecallCard question={QUESTION} card={CARD} face="back" rating={null} defLang={mode} />);
    expect(Boolean(screen.queryByText("说话；谈话"))).toBe(zh);
    expect(Boolean(screen.queryByTestId("word-defs-en"))).toBe(en);
  });

  it("keeps the phrases collapsed on the review back (only the learn page auto-opens them)", () => {
    renderWithProviders(<RecallCard question={QUESTION} card={CARD} face="back" rating={null} />);
    expect(document.querySelector("details")).not.toHaveAttribute("open");
  });
});
