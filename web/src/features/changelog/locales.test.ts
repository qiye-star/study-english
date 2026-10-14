import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ensureChangelogI18n } from "./locales";
import { TAGS } from "./api";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const flatten = (d: unknown, prefix = ""): Record<string, string> =>
  d && typeof d === "object"
    ? Object.entries(d as Dict).reduce<Record<string, string>>((acc, [k, v]) => ({ ...acc, ...flatten(v, prefix ? `${prefix}.${k}` : k) }), {})
    : { [prefix]: String(d) };
const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
const a = flatten(en);
const b = flatten(zh);

describe("changelog locales (R-16: lazy, outside the eager i18n glob)", () => {
  it("has the same keys and placeholders in en and zh-CN, all under web.changelog, no emoji", () => {
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(Object.keys(a).every((k) => k.startsWith("web.changelog."))).toBe(true);
    for (const k of Object.keys(a)) expect(placeholders(a[k]), k).toEqual(placeholders(b[k]));
    for (const [k, v] of [...Object.entries(a), ...Object.entries(b)]) {
      expect(v.trim(), k).not.toBe("");
      expect(v, k).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("names every tag", () => {
    for (const tag of TAGS) expect(a).toHaveProperty([`web.changelog.tag.${tag}`]);
  });

  it("merges into i18next once loaded, pluralises English counts and keeps other keys", () => {
    ensureChangelogI18n();
    expect(i18n.getFixedT("en")("web.changelog.hint", { count: 1 })).toBe("1 new update");
    expect(i18n.getFixedT("en")("web.changelog.hint", { count: 3 })).toBe("3 new updates");
    expect(i18n.getFixedT("zh-CN")("web.changelog.hint", { count: 3 })).toBe("有 3 条新更新");
    expect(i18n.getFixedT("en")("web.changelog.entryUnread", { count: 2 })).toBe("What's new, 2 unread updates");
    expect(i18n.getFixedT("zh-CN")("web.changelog.title")).toBe("更新日志");
    expect(i18n.getFixedT("en")("web.nav.practice")).toBe("Practice");
  });
});
