import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { CEFR_LEVELS, levelLabel, levelMeaning, levelName, parseLevel } from "./levels";

const zh = i18n.getFixedT("zh-CN");
const en = i18n.getFixedT("en");

describe("levels (plan 2026-10-14-level-annotations R-LV1..R-LV5)", () => {
  it("parses CEFR codes, tolerating case, spaces and one trailing plus", () => {
    expect(parseLevel("B1")).toEqual({ base: "B1", plus: false });
    expect(parseLevel(" b1+ ")).toEqual({ base: "B1", plus: true });
    for (const bad of ["", "auto", "B3", "X1", "B1++", null, undefined, 3]) expect(parseLevel(bad)).toBeNull();
  });

  it("reuses the chat wording for A2..C1 and adds A1 / C2, in both languages", () => {
    expect(CEFR_LEVELS.map((l) => levelLabel(zh, l))).toEqual(["A1 · 入门", "A2 · 初级", "B1 · 中级", "B2 · 中高级", "C1 · 高级", "C2 · 精通"]);
    expect(CEFR_LEVELS.map((l) => levelLabel(en, l))).toEqual([
      "A1 · Beginner", "A2 · Elementary", "B1 · Intermediate", "B2 · Upper intermediate", "C1 · Advanced", "C2 · Proficient",
    ]);
  });

  it("keeps a rank tier's plus and explains it with the base level", () => {
    expect(levelLabel(zh, "B1+")).toBe("B1+ · 中级+");
    expect(levelName(en, "c1+")).toBe("Advanced+");
    expect(levelMeaning(zh, "B1+")).toBe(levelMeaning(zh, "B1"));
  });

  it("gives one short meaning per level", () => {
    expect(levelMeaning(zh, "A2")).toBe("能进行简单的日常交流");
    expect(levelMeaning(zh, "B1")).toBe("能应对大多数日常场景");
    expect(levelMeaning(zh, "B2")).toBe("能流利地讨论熟悉的话题");
    expect(levelMeaning(en, "B1")).toBe("Copes with most everyday situations");
    for (const l of CEFR_LEVELS) {
      expect(levelMeaning(zh, l)).toBeTruthy();
      expect(levelMeaning(zh, l)).not.toContain("web.level");
      expect(levelMeaning(en, l)).not.toContain("web.level");
    }
  });

  it("never changes unknown values: raw text, no name, no meaning", () => {
    expect(levelLabel(zh, "X1")).toBe("X1");
    expect(levelLabel(zh, "")).toBe("");
    expect(levelLabel(zh, null)).toBe("");
    expect(levelName(zh, "auto")).toBeNull();
    expect(levelMeaning(zh, "auto")).toBeNull();
  });
});
