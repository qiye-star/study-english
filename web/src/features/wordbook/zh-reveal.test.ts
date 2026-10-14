import { describe, expect, it } from "vitest";
import { zhReveal } from "./def-lang";

const BOTH = {
  senses: [{ pos: "v", text: "说话" }],
  defsEn: [{ pos: "v", text: "speak to someone" }],
  phrases: [{ en: "talk about", zh: "谈论" }],
};

describe("zhReveal (plan 2026-10-14-review-bilingual-longpress R-Z2 / R-Z3)", () => {
  it("hides Chinese senses and phrase translations under English-only and offers the chip; peek brings both back", () => {
    expect(zhReveal("en", BOTH, false)).toMatchObject({ phraseZh: false, chip: true, view: { showSenses: false, showDefs: true } });
    expect(zhReveal("en", BOTH, true)).toMatchObject({ phraseZh: true, chip: true, view: { showSenses: true, showDefs: true } });
  });

  it.each(["zh", "both"] as const)("shows Chinese with no chip under '%s'", (lang) => {
    expect(zhReveal(lang, BOTH, false)).toMatchObject({ phraseZh: true, chip: false, view: { showSenses: true } });
  });

  it("falls back to Chinese with no chip when the word has no English definition", () => {
    expect(zhReveal("en", { ...BOTH, defsEn: [] }, false)).toMatchObject({ phraseZh: true, chip: false, view: { showSenses: true, showDefs: false } });
  });

  it("offers the chip for phrase translations alone, and none when there is no Chinese at all", () => {
    expect(zhReveal("en", { ...BOTH, senses: [] }, false)).toMatchObject({ phraseZh: false, chip: true });
    expect(zhReveal("en", { senses: [], defsEn: BOTH.defsEn, phrases: [{ en: "talk about", zh: " " }] }, false).chip).toBe(false);
  });
});
