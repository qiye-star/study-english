// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * 跟读库家族、跟读弹层、查词、更新日志、底栏是锁定的(计划 2026-10-15-liquid-glass R-LG3):
 * 它们不读新令牌、不出现 liquid: / mat-* / plate;只通过这一份已知的共享模块拿样式(这些模块在锁定路由上被钉回经典皮肤)。
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCKED_DIRS = ["features/library", "features/practice/shadow", "features/lookup", "features/changelog"];
const LOCKED_FILES = ["components/glass-tab-bar.tsx", "layout/bottom-nav.tsx", "components/score-tone.ts", "components/tone.ts", "components/zh-toggle.tsx"];
const BANNED = /\bliquid:|\bmat-(?:surface|float|chrome|sheet)\b|\bplate\b|--mat-|--gx-|--page-(?:top|bottom|flat|sheen|grain)|data-glass/;
/** Shared modules the locked dirs import today (non-test files). A new import needs an INDEX change first. */
const KNOWN_SHARED = [
  "~/components/announcement-banner", "~/components/bottom-sheet", "~/components/glass-tab-bar", "~/components/icon-button", "~/components/level-hint",
  "~/components/list-card", "~/components/score-tone", "~/components/segmented-control", "~/components/tone",
  "~/components/tone-badge", "~/components/zh-toggle", "~/layout/page-header",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx|css)$/.test(name) ? [full] : [];
  });
}
const lockedFiles = [...LOCKED_DIRS.flatMap((d) => walk(path.join(SRC, d))), ...LOCKED_FILES.map((f) => path.join(SRC, f))];

describe("locked pages stay out of the liquid skin (plan 2026-10-15-liquid-glass INDEX §8)", () => {
  it("found the locked files", () => {
    expect(lockedFiles.length).toBeGreaterThan(50);
    expect(lockedFiles.some((f) => f.endsWith("library.css"))).toBe(true);
    expect(lockedFiles.some((f) => f.endsWith("shadow-sheet.css"))).toBe(true);
    expect(lockedFiles.some((f) => f.endsWith("changelog.css"))).toBe(true);
  });

  it("no locked file mentions a liquid token, class or attribute", () => {
    const hits = lockedFiles.filter((f) => BANNED.test(readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f));
    expect(hits).toEqual([]);
  });

  it("locked code imports only the known shared modules", () => {
    const used = new Set<string>();
    for (const f of lockedFiles) {
      if (/\.test\.tsx?$/.test(f) || f.endsWith(".css")) continue;
      for (const m of readFileSync(f, "utf8").matchAll(/from\s+["'](~\/(?:components|layout)\/[\w/-]+)["']/g)) used.add(m[1]);
    }
    expect([...used].sort()).toEqual([...KNOWN_SHARED].sort());
  });

  it("the pin list covers every locked route", async () => {
    const { isPinnedPath } = await import("../lib/glass-flag");
    for (const p of ["/library", "/library/x1", "/practice/changelog"]) expect(isPinnedPath(p)).toBe(true);
  });
});
