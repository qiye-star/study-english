import { afterEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
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

describe("English counts are pluralised (review m10)", () => {
  afterEach(() => { void i18n.changeLanguage("en"); });

  it("says 1 word, 2 words", async () => {
    await i18n.changeLanguage("en");
    const t = i18n.t.bind(i18n);
    expect(t("web.wordbook.summary.learn.count", { count: 1, n: 1 })).toBe("1 new word learned");
    expect(t("web.wordbook.summary.learn.count", { count: 3, n: 3 })).toBe("3 new words learned");
    expect(t("web.wordbook.summary.spell.count", { count: 1, n: 1 })).toBe("1 word spelled");
    expect(t("web.wordbook.summary.mastered", { count: 1, n: 1 })).toBe("1 word now mastered");
    expect(t("web.wordbook.review.due", { count: 1, n: 1 })).toBe("1 word due");
    expect(t("web.wordbookSpell.setHead", { n: 1, total: 2, words: 1, count: 1 })).toBe("Set 1 of 2 · 1 word");
    expect(t("web.wordbookSpell.setHead", { n: 1, total: 2, words: 5, count: 5 })).toBe("Set 1 of 2 · 5 words");
  });

  it("keeps the Chinese copy unchanged", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("web.wordbook.summary.learn.count", { count: 1, n: 1 })).toBe("学会 1 个新词");
    expect(i18n.t("web.wordbook.review.due", { count: 2, n: 2 })).toBe("到期 2 个词");
    expect(i18n.t("web.wordbookSpell.setHead", { n: 1, total: 2, words: 1, count: 1 })).toBe("第 1 组 / 共 2 组 · 1 个词");
  });
});

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
