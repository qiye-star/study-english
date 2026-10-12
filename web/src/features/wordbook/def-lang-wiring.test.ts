import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith("test-fixtures.ts"));

/**
 * R-DW5:`defLang` 是显式 prop,漏传会静默退回「中英」。扫描源码:每个 <WordCardView / <RecallCard / cardModule.WordCardView 的
 * JSX 起始标签(到第一个 `/>` 为止)里必须出现 `defLang=`——所以 defLang 要写在 badge 等带 `/>` 的 prop 之前。
 */
describe("definitions preference wiring", () => {
  it("passes defLang at every word-card call site", () => {
    const missing: string[] = [];
    let seen = 0;
    for (const file of sources) {
      const text = readFileSync(path.join(here, file), "utf8");
      for (const m of text.matchAll(/<(?:cardModule\.)?(?:WordCardView|RecallCard)\b[\s\S]*?\/>/g)) {
        seen += 1;
        if (!/\bdefLang=/.test(m[0])) missing.push(`${file}: ${m[0].slice(0, 60).replace(/\s+/g, " ")}`);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(6); // learn, review, learned, free-browse, link-actions, recall-card (Back)
    expect(missing).toEqual([]);
  });

  it("learn, review, learned and browse read the preference with the shared hook", () => {
    for (const file of ["learn-page.tsx", "review-page.tsx", "learned-page.tsx", "free-browse.tsx"]) {
      expect(readFileSync(path.join(here, file), "utf8"), file).toContain("useDefLangValue()");
    }
  });
});
