// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * 中心颜色守卫(计划 2026-10-15-liquid-glass L12,INDEX §8):在范围内的源码里,任何色调填充(*-tint)或青绿(teal)
 * 类名,必须在同一行或后两行里带液态覆盖(liquid:bg- / liquid:text- / mat- / well / plate / ${LQ_…}),否则失败。
 * 允许的语义标记(蓝色强调、绿 / 琥珀小图标与圆点、红色错误与危险)不在检查之列。锁定区与锁定的共享模块不扫描。
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IN_SCOPE = [
  "components", "layout", "pages", "plugins", "app.tsx",
  "features/practice", "features/chat", "features/grammar", "features/agents", "features/realtime",
  "features/rooms", "features/rank", "features/wordbook", "features/vocabulary", "features/progress",
];
const SKIP = [
  "features/practice/shadow/", "components/tone.ts", "components/score-tone.ts", "components/zh-toggle.tsx",
  "components/glass-tab-bar.tsx", "layout/bottom-nav.tsx",
];
/** Files whose tint values are neutralised elsewhere in the same component (reviewed exceptions). */
const NEUTRALISED_ELSEWHERE: Record<string, string> = {
  "components/stat-tile.tsx": "TILE map; base string adds `well` + liquid label colour",
  "components/hold-to-talk-bar.tsx": "rest/down maps; plate added on the rest strings, pressed stays accent",
};
/**
 * Reviewed line-level exceptions (never whole directories): the line must contain `match`. Each is dead code under the
 * liquid skin (the structure branch renders something else) or is documented in the lane results.
 * Follow-up (L12 results doc): delete these classic-only branches when INDEX Q5 removes the classic code.
 */
const LINE_EXCEPTIONS: { file: string; match: string; reason: string }[] = [
  { file: "features/wordbook/home-page.tsx", match: "bg-teal", reason: "BookCard progress bar + legend: classic-only, liquid renders WordbookTodayLiquid (home-page.tsx `if (liquid)`)" },
];
const BANNED = /(?<![\w:[-])(?:bg|text|border)-(?:blue|teal|amber|green|red)-tint\b|(?<![\w:[-])(?:bg|text|border|stroke)-teal\b/;
const OVERRIDE = /liquid:(?:bg|text|border|stroke)-|liquid:\[|\bmat-(?:surface|float|chrome|sheet)|\bwell\b|\bplate\b|\$\{LQ_|\bLQ_[A-Z_]+/;

function walk(target: string): string[] {
  const full = path.join(SRC, target);
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full).flatMap((name) => walk(path.join(target, name)));
}
const files = IN_SCOPE.flatMap(walk)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .filter((f) => !SKIP.some((s) => path.relative(SRC, f).split(path.sep).join("/").startsWith(s)));

describe("liquid colour guard (plan 2026-10-15-liquid-glass L12)", () => {
  it("scans the in-scope sources", () => {
    expect(files.length).toBeGreaterThan(150);
  }, 30000);

  it("every tint / teal class has a liquid override nearby or a reviewed exception", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (NEUTRALISED_ELSEWHERE[rel]) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || !BANNED.test(line)) return;
        if (LINE_EXCEPTIONS.some((e) => e.file === rel && line.includes(e.match))) return;
        const window = lines.slice(i, i + 3).join("\n");
        if (!OVERRIDE.test(window)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders).toEqual([]);
  }, 30000);
});
