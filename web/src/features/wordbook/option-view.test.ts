import { describe, expect, it } from "vitest";
import { cardForPanel, infoFor, optionRowView, optionsCanPeek } from "./option-view";
import type { Card, OptionInfo, Question } from "./wordbook-api";

const OPT = "v. 说话；谈话；n. 交谈";
const TALK: OptionInfo = {
  option: OPT, word: "talk",
  defsZh: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }, { pos: "n", text: "第三条" }],
  defsEn: [{ pos: "v", text: "speak to someone" }],
};
const BARE: OptionInfo = { option: "v. 放弃", word: "abandon", defsZh: [{ pos: "vt", text: "放弃" }], defsEn: [] }; // 缺口词:没有英文释义
const meaning: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk" }, options: [OPT, "v. 放弃"], length: null };

describe("optionRowView · meaning", () => {
  it("shows the English word and hides the Chinese line under English-only", () => {
    expect(optionRowView("meaning", OPT, TALK, "en", false)).toEqual({ word: "talk", sub: null });
  });

  it("brings the Chinese line back for peek, 'zh' and 'both'", () => {
    expect(optionRowView("meaning", OPT, TALK, "en", true)).toEqual({ word: "talk", sub: OPT });
    expect(optionRowView("meaning", OPT, TALK, "zh", false)).toEqual({ word: "talk", sub: OPT });
    expect(optionRowView("meaning", OPT, TALK, "both", false)).toEqual({ word: "talk", sub: OPT });
  });

  it("falls back to Chinese for a word without an English definition, so the row is never empty of meaning", () => {
    expect(optionRowView("meaning", "v. 放弃", BARE, "en", false)).toEqual({ word: "abandon", sub: "v. 放弃" });
  });

  it("has no word (legacy look) when the server sent no info", () => {
    expect(optionRowView("meaning", OPT, undefined, "en", false)).toEqual({ word: null, sub: null });
  });
});

describe("optionRowView · word", () => {
  it("always shows the word with a small Chinese line and part of speech, whatever def_lang says (spec D3)", () => {
    for (const lang of ["en", "zh", "both"] as const) {
      expect(optionRowView("word", "talk", { ...TALK, option: "talk" }, lang, false)).toEqual({ word: "talk", sub: "v. 说话；谈话；n. 交谈" });
    }
  });

  it("uses the option text as the word when there is no info (the option is the word)", () => {
    expect(optionRowView("word", "talk", undefined, "en", false)).toEqual({ word: "talk", sub: null });
  });

  it("is not a thing for cloze", () => {
    expect(optionRowView("cloze", "talk", undefined, "en", false)).toEqual({ word: null, sub: null });
  });
});

describe("optionsCanPeek", () => {
  it("is only for meaning questions where some option hid its Chinese", () => {
    expect(optionsCanPeek("meaning", "en", [TALK, BARE])).toBe(true);
    expect(optionsCanPeek("meaning", "en", [BARE])).toBe(false); // nothing hidden
    expect(optionsCanPeek("meaning", "zh", [TALK])).toBe(false);
    expect(optionsCanPeek("meaning", "both", [TALK])).toBe(false);
    expect(optionsCanPeek("word", "en", [TALK])).toBe(false);
    expect(optionsCanPeek("meaning", "en", undefined)).toBe(false);
  });
});

describe("infoFor", () => {
  it("matches by option text, not by position", () => {
    expect(infoFor([BARE, TALK], OPT)).toBe(TALK);
    expect(infoFor([BARE, TALK], "nope")).toBeUndefined();
    expect(infoFor(undefined, OPT)).toBeUndefined();
  });
});

describe("cardForPanel", () => {
  const card: Card = { key: "talk", word: "talk", us: "tɔk", uk: "", senses: [], phrases: [], examples: [] };

  it("prefers the batch card", () => {
    expect(cardForPanel(card, meaning, { optionInfo: [TALK], correctOption: OPT })).toBe(card);
  });

  it("builds a card from the correct option's info plus the server's phrases and example when the batch has none", () => {
    const built = cardForPanel(undefined, meaning, {
      optionInfo: [BARE, TALK], correctOption: OPT,
      phrases: [{ en: "talk about", zh: "谈论" }], example: { id: "e1", en: "We talk.", zh: "我们聊天。" },
    });
    expect(built).toMatchObject({ key: "talk", word: "talk", defsEn: TALK.defsEn, senses: TALK.defsZh });
    expect(built?.phrases).toEqual([{ en: "talk about", zh: "谈论" }]);
    expect(built?.examples).toEqual([{ id: "e1", en: "We talk.", zh: "我们聊天。" }]);
  });

  it("is null when there is neither a card nor info for the correct option", () => {
    expect(cardForPanel(undefined, meaning, { correctOption: OPT })).toBeNull();
    expect(cardForPanel(undefined, meaning, { optionInfo: [BARE], correctOption: OPT })).toBeNull();
    expect(cardForPanel(undefined, meaning, { optionInfo: [TALK], correctOption: null })).toBeNull();
  });
});
