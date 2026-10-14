import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEVELS_ZH, levelLong, levelText } from "./levels";

type WebLevel = { name: Record<string, string>; meaning: Record<string, string> };
const webZh = JSON.parse(
  readFileSync(resolve(process.cwd(), "../web/src/components/i18n/zh-CN.json"), "utf8"),
) as { web: { level: WebLevel } };

describe("admin levels (plan 2026-10-14-level-annotations R-LV8)", () => {
  it("uses exactly the web app's Chinese wording", () => {
    expect(Object.keys(LEVELS_ZH)).toEqual(Object.keys(webZh.web.level.name));
    for (const [code, v] of Object.entries(LEVELS_ZH)) {
      expect(v.name).toBe(webZh.web.level.name[code]);
      expect(v.meaning).toBe(webZh.web.level.meaning[code]);
    }
  });

  it("formats known codes and leaves the rest alone", () => {
    expect(levelText("B1")).toBe("B1 · 中级");
    expect(levelText("b2")).toBe("B2 · 中高级");
    expect(levelLong("A2")).toBe("A2 · 初级(能进行简单的日常交流)");
    expect(levelText("X1")).toBe("X1");
    expect(levelText(null)).toBe("");
    expect(levelLong("")).toBe("");
  });
});
