# Liquid glass · L12 final switch (on for everyone, flag plumbing out, colour guard, docs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` (all). **Starts only when L0–L11 are merged AND the owner has reviewed
> the app on a phone with `?glass=v2` and said go.** Serial, last. Then the controller does INDEX §13 (changelog).

**Goal:** one commit turns the new skin on for everyone; the development switch (`enjoy-web.dev.glass`, `?glass=…`) is
removed; `data-glass` stays as the pin mechanism (`"v2"` everywhere, `"pin"` on library/changelog routes — the shared
components they use keep their classic branch forever); a central colour guard keeps tints and teal from coming back
un-neutralised; docs and the device checklist are written; the bundle size is measured (only with the owner's OK).

**Architecture:** `initGlassFlag()` always sets `"v2"`; everything else already keys off the attribute. Classic branches of
the in-scope pages stay in the code for now (dead but harmless); removing them, and collapsing the now-overridden classic
classes, is a separate follow-up (INDEX Q5) so this lane stays small and reversible (revert one commit = old look back).

## Global Constraints

- Files (INDEX §9, serial after everyone): `web/src/lib/glass-flag.ts` (+ test), `web/src/main.tsx` (comment only),
  new `web/src/styles/liquid-colour-guard.test.ts`, `web/README.md`, `web/CLAUDE.md`, `web/src/CLAUDE.md`,
  `web/src/lib/CLAUDE.md`, `web/src/styles/CLAUDE.md`, `docs/superpowers/design/redesign-v3/design-notes.md` (one pointer
  paragraph at the top), new `docs/superpowers/plans/2026-10-15-liquid-glass-device-checklist.md`, new
  `docs/superpowers/plans/2026-10-15-liquid-glass-results.md`; any in-scope source file **only** to fix a colour-guard
  finding (one commit per area).
- Full `yarn web:test`, `yarn web:build`, bundle check, E2E: only when the owner says so (memory: no full suites unless asked).
- Worktree `.claude/worktrees/lg-l12`, branch `feat/lg-l12`, junctioned `node_modules`. CRLF: single-line anchors.
- Commits conventional, one per task, own `Co-Authored-By:` line.

---

## Task L12-1: on for everyone, dev switch removed

**Files:** Modify `web/src/lib/glass-flag.ts`, `web/src/lib/glass-flag.test.ts`, `web/src/main.tsx`.

- [ ] **Step 1 (test):** In `glass-flag.test.ts` replace the two cases "is off by default…" and "?glass=v2 turns it on…" with:
```ts
  it("is on for everyone and forgets the old development switch (plan 2026-10-15-liquid-glass L12)", () => {
    window.localStorage.setItem("enjoy-web.dev.glass", "v2");
    expect(initGlassFlag(fakeWin("?glass=off"))).toBe(true);
    expect(root().getAttribute(GLASS_ATTR)).toBe("v2");
    expect(window.localStorage.getItem("enjoy-web.dev.glass")).toBeNull();
  });
```
  and remove `GLASS_FLAG_KEY`, `readGlassFlag` from the import line; in `afterEach` replace
  `window.localStorage.removeItem(GLASS_FLAG_KEY);` with `window.localStorage.removeItem("enjoy-web.dev.glass");`.
- [ ] **Step 2:** In `glass-flag.ts`: delete `GLASS_FLAG_KEY` and `readGlassFlag`; replace `initGlassFlag` with:
```ts
/** main.tsx, before render: the liquid skin is on for everyone (L12); removes the old development switch. */
export function initGlassFlag(win: Window = window): boolean {
  try {
    win.localStorage.removeItem("enjoy-web.dev.glass");
  } catch {
    /* storage unavailable: nothing to clean */
  }
  win.document.documentElement.setAttribute(GLASS_ATTR, "v2");
  return true;
}
```
  Update the file's JSDoc: "absent = only before `main.tsx` ran (tests); `"pin"` = locked route".
- [ ] **Step 3:** `main.tsx`: single line `initGlassFlag(); // 液态玻璃开发开关(?glass=v2),默认关(计划 2026-10-15-liquid-glass)` →
  `initGlassFlag(); // 液态玻璃皮肤(计划 2026-10-15-liquid-glass);跟读库 / 更新日志路由由 GlassRoutePin 钉回经典`.
- [ ] **Step 4:** `Grep` for `GLASS_FLAG_KEY|readGlassFlag|glass=v2|enjoy-web.dev.glass` in `web/src` and `web/e2e`: only the
  cleanup string in `glass-flag.ts` / its test may remain.
- [ ] **Step 5:** Run `cd web && yarn vitest run src/lib src/layout src/styles src/components src/architecture.test.ts` — green.
- [ ] **Step 6:** Commit `feat(web): liquid glass on for everyone`.

---

## Task L12-2: central colour guard

**Files:** Create `web/src/styles/liquid-colour-guard.test.ts`.

- [ ] **Step 1:** Write it:
```ts
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
  });

  it("every tint / teal class has a liquid override nearby or a reviewed exception", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (NEUTRALISED_ELSEWHERE[rel]) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || !BANNED.test(line)) return;
        const window = lines.slice(i, i + 3).join("\n");
        if (!OVERRIDE.test(window)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/styles/liquid-colour-guard.test.ts`. For each offender:
  (a) a lane missed a mapping row → fix the source with the INDEX §6 mapping (one commit per area, `fix(web): …`);
  (b) a value is neutralised elsewhere in the same component → add it to `NEUTRALISED_ELSEWHERE` with a one-line reason;
  (c) never add a whole directory to `SKIP`.
- [ ] **Step 3:** Commit `test(web): central liquid colour guard`.

---

## Task L12-3: docs, design-notes pointer, device checklist, results

- [ ] **Step 1:** `web/README.md`: add a section "Liquid glass skin" (what it is, where the theme settings live, that it is
  device-local and cleared at logout, the pinned routes) and extend the UNVERIFIED list with: real blur quality and frame
  rate on low-end Android with 3 blur layers; iOS Safari sheet blur flicker; capsule fade with blur; custom backgrounds
  outdoors; graphite bubbles with the lookup highlight; monochrome quiz feedback; large titles at 320–360px;
  `prefers-reduced-transparency` on iOS; old WebViews without `:is()` / `rgb(r g b / a)`.
- [ ] **Step 2:** `web/CLAUDE.md` Pitfalls: `- Liquid glass (plan 2026-10-15-liquid-glass): append liquid: / LQ_* classes, never re-value tokens; Rule 4 (only titles and icons on blurred layers, other text on .plate); ≤ 3 resident blur layers + 1 transient (styles/glass-budget.test.ts); library/changelog routes are pinned to the classic skin.`
  `web/src/CLAUDE.md` Layers: mention `lib/glass-flag.ts`, `lib/glass-theme.ts`, `settings/glass-theme-store.ts`.
  `web/src/lib/CLAUDE.md`: update the `glass-flag.ts` line (no dev switch any more).
- [ ] **Step 3:** `docs/superpowers/design/redesign-v3/design-notes.md`: add at the top:
  `> 2026-10-15: superseded for every in-scope page by the liquid-glass skin (spec 2026-10-15-liquid-glass-overall-design-proposal, design liquid-glass-v2, plans 2026-10-15-liquid-glass-*). The tokens here still drive the library, shadow sheet, lookup, tab bar and changelog, which are pinned.`
- [ ] **Step 4:** Write `docs/superpowers/plans/2026-10-15-liquid-glass-device-checklist.md` from INDEX §10 point 4 plus every
  lane's "Device checklist" section, as `- [ ]` items grouped by phone (iPhone, low-end Android, OLED dark), each marked
  UNVERIFIED.
- [ ] **Step 5:** Write `docs/superpowers/plans/2026-10-15-liquid-glass-results.md` with: merged lanes and commits, the tests
  run per lane (as reported), deviations taken (INDEX D-1…D-9), and the open questions still open. Mark everything not run
  on a real device as UNVERIFIED.
- [ ] **Step 6:** Commit `docs: liquid glass docs, checklist and results`.

---

## Task L12-4: bundle note (controller, only with the owner's OK)

- [ ] With the owner's OK: `yarn web:build` then `node web/scripts/check-main-bundle.mjs --max-delta=2.5` (from the repo
  root, after the build). Record main JS gzip, CSS gzip and the delta vs `main-bundle-baseline.json` in the results file.
  Budget for the whole set (INDEX §10): main JS ≤ +2.5 kB gzip, CSS ≤ +3 kB gzip. Re-record the baseline (`--record`) only
  if the owner approves the new number.
- [ ] Without the OK: write "bundle not measured (not run)" in the results file.

---

## Task L12-5: full verification (controller, only with the owner's OK)

- [ ] `yarn web:typecheck && yarn web:test` (full) — green.
- [ ] Browser pass per INDEX §10 point 4 at 390×844 in light and dark (no `?glass` parameter needed any more), including
  `/library` and `/practice/changelog` looking exactly as before.
- [ ] Optional, owner's call: `yarn web:e2e --project=chromium-mobile` (needs the E2E stack and real upstreams, costs money).
- [ ] Then the controller's INDEX §13 (changelog draft) after deploy + owner check.

## Rollback

- Revert the L12-1 commit → `data-glass` is absent again for everyone (classic look); the theme settings page redirects to
  `/me` and the Me row disappears; stored theme prefs stay on the device (harmless) until logout.
