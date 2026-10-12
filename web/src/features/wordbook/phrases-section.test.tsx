import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { WORDBOOK_PREFS_KEY } from "~/lib/storage";
import { renderWithProviders } from "~/test/render";
import { PhrasesSection } from "./phrases-section";
import { readPhrasesPref, writePhrasesPref } from "./phrases-pref";
import { card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

const PHRASES = [{ en: "talk about", zh: "谈论" }, { en: "talk back", zh: "顶嘴" }];
const details = () => document.querySelector("details")!;
const summary = () => document.querySelector("summary")!;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("PhrasesSection", () => {
  it("collapsed mode (false) looks like before: closed, first phrase previewed in the summary", () => {
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode={false} />);
    expect(details()).not.toHaveAttribute("open");
    expect(summary()).toHaveTextContent("短语 · talk about 谈论");
  });

  it("auto mode opens on first appearance and drops the duplicate first-phrase preview", () => {
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode="auto" />);
    expect(details()).toHaveAttribute("open");
    expect(summary()).toHaveTextContent(/^短语$/);
    expect(screen.getAllByText("talk about")).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("auto mode stays closed after the user closed it on this device", () => {
    writePhrasesPref(false);
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode="auto" />);
    expect(details()).not.toHaveAttribute("open");
    expect(summary()).toHaveTextContent("短语 · talk about 谈论");
  });

  it("auto mode opens when storage is unavailable (treated as auto)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode="auto" />);
    expect(details()).toHaveAttribute("open");
  });

  it("a manual close in auto mode is remembered; a manual reopen too; the DOM state follows React state", async () => {
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode="auto" />);
    await userEvent.click(summary());
    expect(details()).not.toHaveAttribute("open");
    expect(details().open).toBe(false);
    expect(readPhrasesPref()).toBe(false);
    expect(summary()).toHaveTextContent("短语 · talk about 谈论");
    await userEvent.click(summary());
    expect(details().open).toBe(true);
    expect(readPhrasesPref()).toBe(true);
  });

  it("a manual open on a collapsed page never writes the preference (R-DW10 c)", async () => {
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode={false} />);
    await userEvent.click(summary());
    expect(details().open).toBe(true);
    await userEvent.click(summary());
    expect(details().open).toBe(false);
    expect(localStorage.getItem(WORDBOOK_PREFS_KEY)).toBeNull();
  });

  it("shows at most five phrases", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ en: `phrase ${i}`, zh: `短语${i}` }));
    renderWithProviders(<PhrasesSection phrases={many} mode={true} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("keeps the disclosure semantics: a real summary inside details, 44px target, decorative chevron", () => {
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode="auto" />);
    expect(summary().parentElement).toBe(details());
    expect(summary().className).toContain("min-h-tap");
    expect(summary().querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing for a card without phrases", () => {
    renderWithProviders(<PhrasesSection phrases={[]} mode="auto" />);
    expect(document.querySelector("details")).toBeNull();
  });
});

describe("WordCardView phrasesOpen", () => {
  const TALK = card("talk", { phrases: PHRASES }) as unknown as Card;

  it("defaults to collapsed even when the device preference says open", () => {
    writePhrasesPref(true);
    renderWithProviders(<WordCardView card={TALK} />);
    expect(details()).not.toHaveAttribute("open");
  });

  it('"auto" opens only once the card is uncovered (covered: no phrases in the DOM)', async () => {
    function Reveal() {
      const [covered, setCovered] = useState(true);
      return <WordCardView card={TALK} covered={covered} onReveal={() => setCovered(false)} phrasesOpen="auto" />;
    }
    renderWithProviders(<Reveal />);
    expect(document.querySelector("details")).toBeNull();
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("talk about");
    await userEvent.click(screen.getByTestId("recall-cover"));
    expect(details()).toHaveAttribute("open");
    expect(summary()).toHaveTextContent(/^短语$/);
  });

  it("a collapsed card (default / false) keeps showing the first phrase in the summary and never writes the preference", async () => {
    renderWithProviders(<WordCardView card={TALK} phrasesOpen={false} />);
    expect(summary()).toHaveTextContent("短语 · talk about 谈论");
    await userEvent.click(summary());
    expect(localStorage.getItem(WORDBOOK_PREFS_KEY)).toBeNull();
  });
});
