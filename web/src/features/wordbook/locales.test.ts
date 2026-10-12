import { describe, expect, it } from "vitest";
import i18n, { webMessages } from "~/i18n";
import { ensureWordbookDefsI18n } from "./locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const keysOf = (d: unknown, prefix = ""): string[] =>
  d && typeof d === "object" ? Object.entries(d as Dict).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
const at = (d: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc as Dict | undefined)?.[k], d);

describe("wordbook definitions locales (R-DW1: lazy, outside the eager i18n glob)", () => {
  it("has the same keys in en and zh-CN, all under web.wordbookDefs", () => {
    expect(keysOf(en).sort()).toEqual(keysOf(zh).sort());
    expect(keysOf(en).every((k) => k.startsWith("web.wordbookDefs."))).toBe(true);
  });

  it("is not part of the eagerly merged web messages (so it cannot grow the main bundle)", () => {
    expect(at(webMessages("en"), "web.wordbookDefs")).toBeUndefined();
    expect(at(webMessages("zh-CN"), "web.wordbookDefs")).toBeUndefined();
  });

  it("merges into i18next once loaded and does not overwrite the eager wordbook keys", () => {
    ensureWordbookDefsI18n();
    ensureWordbookDefsI18n(); // idempotent
    expect(i18n.getFixedT("zh-CN")("web.wordbookDefs.setting.label")).toBe("释义显示");
    expect(i18n.getFixedT("zh-CN")("web.wordbookDefs.setting.options.zh")).toBe("仅中文");
    expect(i18n.getFixedT("en")("web.wordbookDefs.setting.options.en")).toBe("English only");
    expect(i18n.getFixedT("en")("web.wordbook.word.phrases")).toBeTruthy();
    expect(i18n.getFixedT("en")("web.wordbook.goals.saved")).toBeTruthy();
  });

  it("keeps the one-line segmented labels short enough for a 360 px sheet (jsdom has no layout; real width unverified)", () => {
    for (const key of ["both", "zh", "en"]) {
      expect(String(at(en, `web.wordbookDefs.setting.options.${key}`)).length, key).toBeLessThanOrEqual(12);
      expect(String(at(zh, `web.wordbookDefs.setting.options.${key}`)).length, key).toBeLessThanOrEqual(4);
    }
  });
});
