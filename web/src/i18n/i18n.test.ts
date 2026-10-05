import { describe, expect, it } from "vitest";
import i18n, { deepMerge, webMessages } from "./index";

/** 递归比较两份字典的键集(含数组长度),返回人类可读的差异。 */
function i18nKeyDiff(en: unknown, zh: unknown, prefix = ""): string[] {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (Array.isArray(en) && Array.isArray(zh)) {
    const out = en.length !== zh.length ? [`array length differs at ${prefix} (en ${en.length}, zh-CN ${zh.length})`] : [];
    for (let i = 0; i < Math.min(en.length, zh.length); i++) out.push(...i18nKeyDiff(en[i], zh[i], `${prefix}[${i}]`));
    return out;
  }
  if (isObj(en) && isObj(zh)) {
    const out: string[] = [];
    for (const k of new Set([...Object.keys(en), ...Object.keys(zh)])) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (!(k in zh)) out.push(`only in en: ${path}`);
      else if (!(k in en)) out.push(`only in zh-CN: ${path}`);
      else out.push(...i18nKeyDiff(en[k], zh[k], path));
    }
    return out;
  }
  return isObj(en) !== isObj(zh) || Array.isArray(en) !== Array.isArray(zh) ? [`shape differs at ${prefix}`] : [];
}

describe("i18n", () => {
  it("merges web keys for en and zh-CN", () => {
    expect(i18n.getFixedT("en")("web.appName")).toBe("Enjoy English Practice");
    expect(i18n.getFixedT("zh-CN")("web.appName")).toBe("Enjoy 英语练习");
  });
  it("keeps the desktop language packs", () => {
    expect(i18n.getFixedT("zh-CN")("pronunciationAssessment")).toBe("发音评估");
  });
  it("falls back to English for web keys in es", () => {
    expect(i18n.getFixedT("es")("web.nav.chat")).toBe("Chat");
  });
  it("collects web messages from i18n folders", () => {
    expect((webMessages("zh-CN").web as any).nav.practice).toBe("练习");
  });
  it("deepMerge merges nested objects without mutating inputs", () => {
    const a = { web: { a: 1, nested: { x: 1 } } };
    expect(deepMerge(a, { web: { nested: { y: 2 } } })).toEqual({ web: { a: 1, nested: { x: 1, y: 2 } } });
    expect(a).toEqual({ web: { a: 1, nested: { x: 1 } } });
  });
  it("has exactly the same web keys in en and zh-CN, per directory", () => {
    const files = import.meta.glob<Record<string, unknown>>("../**/i18n/*.json", { eager: true, import: "default" });
    const dirs = new Map<string, Partial<Record<"en" | "zh-CN", Record<string, unknown>>>>();
    for (const [file, dict] of Object.entries(files)) {
      const m = file.match(/^(.*)\/(en|zh-CN)\.json$/);
      if (!m) continue;
      dirs.set(m[1], { ...dirs.get(m[1]), [m[2]]: dict });
    }
    expect(dirs.size).toBeGreaterThan(0);
    const problems = [...dirs.entries()].flatMap(([dir, pair]) =>
      !pair.en || !pair["zh-CN"] ? [`${dir}: missing en or zh-CN file`] : i18nKeyDiff(pair.en, pair["zh-CN"]).map((d) => `${dir}: ${d}`),
    );
    expect(problems).toEqual([]);
  });
  it("i18nKeyDiff reports one-sided keys and array length mismatches", () => {
    expect(i18nKeyDiff({ a: { b: "x", c: "y" }, l: ["1", "2"] }, { a: { b: "x" }, d: "z", l: ["1"] }).sort()).toEqual(
      ["only in en: a.c", "only in zh-CN: d", "array length differs at l (en 2, zh-CN 1)"].sort(),
    );
    expect(i18nKeyDiff({ a: "x" }, { a: "y" })).toEqual([]);
  });
});
