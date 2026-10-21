import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";
import { ensureDubbingI18n } from "./locales";

type Json = { [k: string]: string | Json };

/** 叶子路径 → 字符串值(`web.dubbing.errors.notReady` 形式)。 */
function flat(node: Json, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flat(value, path));
  }
  return out;
}

const EN = flat(en as Json);
const ZH = flat(zh as Json);
const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
const EMOJI = /\p{Extended_Pictographic}/u;

describe("dubbing locales (plan L5 R20: en and zh-CN only)", () => {
  it("both languages have the same keys", () => {
    expect(Object.keys(ZH).sort()).toEqual(Object.keys(EN).sort());
  });

  it("every key is under web.dubbing. and no value is empty", () => {
    for (const [key, value] of Object.entries({ ...EN, ...ZH })) {
      expect(key.startsWith("web.dubbing."), key).toBe(true);
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("placeholders match between languages", () => {
    for (const key of Object.keys(EN)) expect(placeholders(ZH[key]), key).toEqual(placeholders(EN[key]));
  });

  it("no emoji in user-facing copy", () => {
    for (const value of [...Object.values(EN), ...Object.values(ZH)]) expect(EMOJI.test(value), value).toBe(false);
  });

  it("ensureDubbingI18n merges both languages without overwriting other keys", () => {
    ensureDubbingI18n();
    expect(i18n.getResource("en", "translation", "web.dubbing.errors.notReady")).toBe(EN["web.dubbing.errors.notReady"]);
    expect(i18n.getResource("zh-CN", "translation", "web.dubbing.errors.notReady")).toBe(ZH["web.dubbing.errors.notReady"]);
  });
});
