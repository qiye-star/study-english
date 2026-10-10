import { describe, expect, it } from "vitest";
import en from "./i18n/en.json";
import zh from "./i18n/zh-CN.json";
import spellEn from "./spell/i18n/en.json";
import spellZh from "./spell/i18n/zh-CN.json";

/** 把嵌套文案拍平成 "a.b.c" → 值。 */
function flatten(node: unknown, prefix = ""): Record<string, unknown> {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return { [prefix]: node };
  return Object.entries(node as Record<string, unknown>).reduce<Record<string, unknown>>(
    (acc, [k, v]) => ({ ...acc, ...flatten(v, prefix ? `${prefix}.${k}` : k) }),
    {},
  );
}

const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

describe.each([
  ["wordbook", en, zh],
  ["wordbook/spell", spellEn, spellZh],
])("%s i18n", (_name, enDict, zhDict) => {
  const a = flatten(enDict);
  const b = flatten(zhDict);

  it("has the same keys in en and zh-CN", () => {
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  it("has no empty or non-string values", () => {
    for (const [key, value] of [...Object.entries(a), ...Object.entries(b)]) {
      expect(typeof value, key).toBe("string");
      expect((value as string).trim(), key).not.toBe("");
    }
  });

  it("uses the same placeholders in both languages", () => {
    for (const key of Object.keys(a)) {
      expect(placeholders(String(a[key])), key).toEqual(placeholders(String(b[key])));
    }
  });

  it("keeps emoji out of the UI copy", () => {
    for (const [key, value] of [...Object.entries(a), ...Object.entries(b)]) {
      expect(/\p{Extended_Pictographic}/u.test(String(value)), key).toBe(false);
    }
  });
});
