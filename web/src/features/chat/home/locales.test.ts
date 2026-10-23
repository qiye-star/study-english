// @vitest-environment node
import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import "./locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Tree = { [key: string]: string | Tree };
const homeEn = en.web.chat.home as unknown as Tree;
const homeZh = zh.web.chat.home as unknown as Tree;

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === "string") acc[prefix + k] = v;
    else Object.assign(acc, flatten(v, `${prefix}${k}.`));
    return acc;
  }, {});
}
const e = flatten(homeEn);
const z = flatten(homeZh);
const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe("web.chat.home copy (FR17)", () => {
  it("has the same keys in en and zh-CN", () => {
    expect(Object.keys(z).sort()).toEqual(Object.keys(e).sort());
  });

  it("has no empty strings", () => {
    for (const [k, v] of [...Object.entries(e), ...Object.entries(z)]) expect(v.trim(), k).not.toBe("");
  });

  it("uses the same interpolation placeholders in both languages", () => {
    for (const k of Object.keys(e)) expect(placeholders(z[k]), k).toEqual(placeholders(e[k]));
  });

  it("writes the greeting-language labels the same way in every UI language", () => {
    for (const k of ["settings.language.zh", "settings.language.en", "settings.language.bilingual"]) expect(z[k], k).toBe(e[k]);
    expect(e["settings.language.bilingual"]).toBe("中英双语");
  });

  it("has a title, a skip label with its accessible name and a full spoken line per stat", () => {
    for (const set of [e, z]) {
      for (const k of ["greeting.title", "greeting.skip", "greeting.skipAria", "greeting.stats.streakSr", "greeting.stats.dueSr", "greeting.stats.mistakesSr"]) {
        expect(set[k], k).toBeTruthy();
      }
    }
  });

  it("keeps English copy free of Chinese characters (except the fixed language label)", () => {
    for (const [k, v] of Object.entries(e)) {
      if (k === "settings.language.zh" || k === "settings.language.bilingual") continue;
      expect(v, k).not.toMatch(/[一-鿿]/);
    }
  });

  it("is merged into i18next when a lazy entry imports ./locales (and is not in the eager main-bundle glob)", () => {
    expect(i18n.getFixedT("zh-CN")("web.chat.home.settings.done")).toBe("完成");
    expect(i18n.getFixedT("en")("web.chat.home.settings.done")).toBe("Done");
  });
});
