import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { DEFS_EN, card, normalizeIds as normalize } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

const BASE = {
  senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }],
  phrases: [{ en: "talk about", zh: "谈论" }],
};
const PLAIN = card("talk", BASE) as unknown as Card;
const WITH_DEFS = { ...card("talk", BASE), defsEn: DEFS_EN } as unknown as Card;
const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("English definitions on the word card", () => {
  it("shows them under the Chinese meaning, per POS, at most two per POS, in lang=en", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="both" />);
    const list = screen.getByTestId("word-defs-en");
    expect(list).toHaveAccessibleName("英文释义(参考)");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("lang", "en");
    expect(rows[0]).toHaveTextContent("v. exchange thoughts or ideas by speaking; use language to express something");
    expect(rows[1]).toHaveTextContent("n. an exchange of ideas by speaking");
    expect(list).not.toHaveTextContent("third verb definition");
    expect(list.className).toContain("mt-1.5"); // right under the Chinese meaning
    expect(rows[0].className).toContain("text-ink-2");
    expect(rows[0].className).toContain("text-sub");
  });

  it("orders Chinese meaning, English definitions, example, phrases", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="both" />);
    const zh = screen.getByText("说话；谈话");
    const en = screen.getByTestId("word-defs-en");
    const example = screen.getByText("talk", { selector: "mark" }); // the highlighted headword inside the example sentence
    const phrases = document.querySelector("details")!;
    expect(before(zh, en)).toBe(true);
    expect(before(en, example)).toBe(true);
    expect(before(example, phrases)).toBe(true);
  });

  it("zh hides English entirely and renders byte-for-byte what a card without defsEn renders", () => {
    const a = renderWithProviders(<WordCardView card={WITH_DEFS} defLang="zh" />);
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
    const withDefs = normalize(a.container.innerHTML);
    a.unmount();
    const b = renderWithProviders(<WordCardView card={PLAIN} defLang="zh" />);
    expect(normalize(b.container.innerHTML)).toBe(withDefs);
  });

  it("en hides the Chinese meaning lines but keeps POS labels, example translation and phrase translation", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" />);
    expect(screen.queryByText("说话；谈话")).toBeNull();
    expect(screen.queryByText("交谈")).toBeNull();
    const list = screen.getByTestId("word-defs-en");
    expect(within(list).getByText("v.")).toBeTruthy();
    expect(within(list).getByText("n.")).toBeTruthy();
    expect(list.className).toContain("mt-3.5"); // the English rows are the first block now
    expect(screen.getByText("他们常常talk。")).toBeTruthy(); // example translation is not a definition
    expect(screen.getByText("谈论")).toBeTruthy(); // phrase translation is not a definition
  });

  it("en falls back to the Chinese meaning for words without English definitions (R-DW6)", () => {
    renderWithProviders(<WordCardView card={PLAIN} defLang="en" />);
    expect(screen.getByText("说话；谈话")).toBeTruthy();
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
    const empty = { ...PLAIN, defsEn: [] } as Card;
    renderWithProviders(<WordCardView card={empty} defLang="en" />);
    expect(screen.getAllByText("说话；谈话")).toHaveLength(2);
  });

  it("keeps definitions out of the DOM while the card is covered, and shows them once revealed", () => {
    const view = renderWithProviders(<WordCardView card={WITH_DEFS} covered onReveal={() => {}} />);
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("exchange thoughts");
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("说话；谈话");
    view.unmount();
    renderWithProviders(<WordCardView card={WITH_DEFS} />);
    expect(screen.getByTestId("word-defs-en")).toBeTruthy();
  });

  it("covered stays free of both languages in every mode", () => {
    for (const mode of ["both", "zh", "en"] as const) {
      const view = renderWithProviders(<WordCardView card={WITH_DEFS} covered defLang={mode} onReveal={() => {}} />);
      const text = screen.getByTestId("word-card").textContent ?? "";
      expect(text, mode).not.toContain("exchange thoughts");
      expect(text, mode).not.toContain("说话；谈话");
      view.unmount();
    }
  });

  it("an old card without defsEn renders exactly as before in every mode", () => {
    for (const mode of ["both", "zh", "en"] as const) {
      const first = renderWithProviders(<WordCardView card={PLAIN} defLang={mode} />);
      const html = normalize(first.container.innerHTML);
      first.unmount();
      const second = renderWithProviders(<WordCardView card={PLAIN} />);
      expect(html, mode).toBe(normalize(second.container.innerHTML));
      second.unmount();
    }
  });

  it("ignores blank texts and unknown POS codes safely", () => {
    const odd = { ...PLAIN, defsEn: [{ pos: "x", text: "odd one" }, { pos: "n", text: "  " }] } as Card;
    renderWithProviders(<WordCardView card={odd} defLang="both" />);
    const rows = within(screen.getByTestId("word-defs-en")).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("x. odd one");
  });
});
