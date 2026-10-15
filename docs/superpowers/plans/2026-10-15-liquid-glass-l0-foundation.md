# Liquid glass · L0 foundation (switch, tokens, variant, materials, guards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` (§3 rulings, §4 switch/variant, §5 tokens and classes, §8 guards, §9 ownership).
> This lane is **first and serial**; L1 and L2 start after it merges.

**Goal:** lay the rails for the liquid-glass skin without changing anything a user can see: a development switch
(`html[data-glass="v2"]`, default off), route pins for the locked pages, the new tokens, the `liquid:` Tailwind variant,
the self-gated material classes (`mat-*`, `well`, `plate`, `page-bg`), the shell background, and the guard tests
(blur budget, locked pages, token pairs, variant compile) plus DOM helpers the other lanes use.

**Architecture:** `lib/glass-flag.ts` (pure DOM + one React hook, low layer) decides the attribute before the first render
(`main.tsx`); `layout/glass-route-pin.tsx` flips it to `"pin"` on locked routes. All new CSS lives in one marked section at the
end of `index.css`, every selector scoped with `html[data-glass="v2"]`, so with the switch off no new rule can match. Tokens
are added to `theme.css` (both modes). Tailwind gets a `liquid:` variant (`&:is([data-glass="v2"] *)`) and the new
radius/colour/shadow/font tokens.

**Tech stack:** Tailwind 3.4, PostCSS 8, React 18, vitest (jsdom + node). No new dependency.

## Global Constraints

- Owned files (INDEX §9): `web/src/styles/theme.css`, `web/src/index.css`, `web/tailwind.config.cjs`, `web/src/lib/cn.ts`,
  `web/src/lib/cn.test.ts`, `web/src/lib/glass-flag.ts` (+ `.test.ts`), `web/src/layout/glass-route-pin.tsx` (+ `.test.tsx`),
  `web/src/layout/app-shell.tsx`, `web/src/main.tsx`, `web/src/app.tsx` (one class in `AnnouncementFrame` only),
  `web/src/test/glass.ts` (+ `glass.test.tsx`), `web/src/styles/{glass-budget,locked-pages,liquid-tokens,liquid-variant}.test.ts`,
  `web/src/styles/CLAUDE.md`, `web/src/layout/CLAUDE.md` (two lines), `web/src/lib/CLAUDE.md` (one line).
- **Nothing visible changes with the switch off.** Existing tests must pass unchanged, in particular
  `styles/{theme,floating-tab-bar,glass-lookup,viewport-lock}.test.ts`, `features/library/library-css.test.ts`,
  `layout/layout.test.tsx`, `components/primitives.test.tsx`. Do not edit existing `.glass*` rules or tokens.
- Never edit `enjoy/`, locked files (INDEX R-LG3), `architecture.test.ts`.
- Worktree: `.claude/worktrees/lg-l0`, branch `feat/lg-l0`; junction `node_modules` and `web/node_modules` from the main
  checkout (`cmd /c mklink /J node_modules <main>\node_modules`), do not install.
- The worktree is CRLF: use the Edit tool with single-line anchors; Read the file first when an anchor spans lines.
- Tests per task: `cd web && yarn vitest run <files> src/architecture.test.ts`; at the end `yarn web:typecheck` (repo root).
  No full suite, no build, no E2E, no containers.
- Commits: conventional (`feat(web): …`, `test(web): …`), one per task, each ending with the implementer's own
  `Co-Authored-By:` line.

## Rulings specific to L0

- **R-L0-1** The dev switch is read once at load: `?glass=v2` stores `"v2"` under `enjoy-web.dev.glass`, `?glass=off`
  removes it. No UI toggle (the owner uses the URL). The query parameter carries no user data.
- **R-L0-2** Pins are route based (no CSS `:has`): `/library`, `/library/*`, `/practice/changelog` → `data-glass="pin"`.
  `useLayoutEffect` so the first paint of a pinned route is already classic.
- **R-L0-3** Material classes are plain CSS outside `@layer`, scoped `html[data-glass="v2"] .x` (0,2,1) so they beat the
  classic utilities they sit next to (including `dark:` variants, 0,2,0).
- **R-L0-4** `mat-sheet` draws the T3 bezel and the Rule-4 plate on one element (8px transparent border, plate on
  `padding-box`, glass on `border-box`), so `BottomSheetContent`'s DOM never needs a wrapper.
- **R-L0-5** No iOS "settle" trick in CSS (Radix animations under reduced motion would never fire `animationend`);
  the flicker risk stays on the device checklist (INDEX K3).

---

## Task L0-1: `lib/glass-flag.ts` — switch, pins, `useLiquid()`

**Files:** Create `web/src/lib/glass-flag.ts`, `web/src/lib/glass-flag.test.ts`.

- [ ] **Step 1 (test):** Write `web/src/lib/glass-flag.test.ts`:
```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  GLASS_ATTR, GLASS_FLAG_KEY, initGlassFlag, isGlassOn, isLiquid, isPinnedPath, readGlassFlag, setGlassPinned, useLiquid,
} from "./glass-flag";

const fakeWin = (search: string): Window =>
  ({ location: { search }, localStorage: window.localStorage, document } as unknown as Window);
const root = () => document.documentElement;

describe("glass flag (plan 2026-10-15-liquid-glass L0, INDEX §4.1)", () => {
  afterEach(() => {
    root().removeAttribute(GLASS_ATTR);
    window.localStorage.removeItem(GLASS_FLAG_KEY);
  });

  it("is off by default and stays off without the query parameter", () => {
    expect(readGlassFlag(fakeWin(""))).toBe(false);
    expect(initGlassFlag(fakeWin(""))).toBe(false);
    expect(root().hasAttribute(GLASS_ATTR)).toBe(false);
    expect(isGlassOn()).toBe(false);
    expect(isLiquid()).toBe(false);
  });

  it("?glass=v2 turns it on and remembers it; ?glass=off forgets it", () => {
    expect(initGlassFlag(fakeWin("?glass=v2"))).toBe(true);
    expect(root().getAttribute(GLASS_ATTR)).toBe("v2");
    expect(window.localStorage.getItem(GLASS_FLAG_KEY)).toBe("v2");
    expect(initGlassFlag(fakeWin(""))).toBe(true);
    expect(initGlassFlag(fakeWin("?glass=off"))).toBe(false);
    expect(root().hasAttribute(GLASS_ATTR)).toBe(false);
    expect(window.localStorage.getItem(GLASS_FLAG_KEY)).toBeNull();
  });

  it("pins only the locked routes", () => {
    for (const p of ["/library", "/library/abc", "/practice/changelog"]) expect(isPinnedPath(p), p).toBe(true);
    for (const p of ["/practice", "/practice/list", "/libraryx", "/me", "/chat/1"]) expect(isPinnedPath(p), p).toBe(false);
  });

  it("setGlassPinned flips v2 <-> pin and never turns the switch on", () => {
    setGlassPinned(true);
    expect(root().hasAttribute(GLASS_ATTR)).toBe(false);
    root().setAttribute(GLASS_ATTR, "v2");
    setGlassPinned(true);
    expect(root().getAttribute(GLASS_ATTR)).toBe("pin");
    expect(isGlassOn()).toBe(true);
    expect(isLiquid()).toBe(false);
    setGlassPinned(false);
    expect(isLiquid()).toBe(true);
  });

  it("useLiquid follows the attribute", async () => {
    const { result } = renderHook(() => useLiquid());
    expect(result.current).toBe(false);
    await act(async () => { root().setAttribute(GLASS_ATTR, "v2"); });
    expect(result.current).toBe(true);
    await act(async () => { root().setAttribute(GLASS_ATTR, "pin"); });
    expect(result.current).toBe(false);
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/lib/glass-flag.test.ts` — fails (module missing).
- [ ] **Step 3:** Write `web/src/lib/glass-flag.ts`:
```ts
import { useSyncExternalStore } from "react";

/**
 * Liquid-glass switch (plan 2026-10-15-liquid-glass, INDEX §4.1).
 * <html data-glass="v2"> = new skin; "pin" = switch on but a locked route (library, changelog) keeps the classic skin;
 * absent = classic. The dev switch is read once before the first render (main.tsx). GLASS_FLAG_KEY goes away in L12.
 */
export const GLASS_ATTR = "data-glass";
export const GLASS_FLAG_KEY = "enjoy-web.dev.glass";
export const PINNED_PATH_PREFIXES = ["/library", "/practice/changelog"] as const;

/** ?glass=v2 remembers the switch on this device, ?glass=off forgets it; then reads it. Storage errors → URL only. */
export function readGlassFlag(win: Window = window): boolean {
  let param: string | null = null;
  try {
    param = new URLSearchParams(win.location.search).get("glass");
  } catch {
    param = null;
  }
  try {
    if (param === "v2") win.localStorage.setItem(GLASS_FLAG_KEY, "v2");
    else if (param === "off") win.localStorage.removeItem(GLASS_FLAG_KEY);
    return win.localStorage.getItem(GLASS_FLAG_KEY) === "v2";
  } catch {
    return param === "v2";
  }
}

/** main.tsx, before render: sets or removes data-glass="v2" on <html>. */
export function initGlassFlag(win: Window = window): boolean {
  const on = readGlassFlag(win);
  const root = win.document.documentElement;
  if (on) root.setAttribute(GLASS_ATTR, "v2");
  else root.removeAttribute(GLASS_ATTR);
  return on;
}

export function isPinnedPath(pathname: string): boolean {
  return PINNED_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** "v2" <-> "pin" while the switch is on; does nothing when it is off. */
export function setGlassPinned(pinned: boolean, doc: Document = document): void {
  const root = doc.documentElement;
  if (!root.hasAttribute(GLASS_ATTR)) return;
  const next = pinned ? "pin" : "v2";
  if (root.getAttribute(GLASS_ATTR) !== next) root.setAttribute(GLASS_ATTR, next);
}

export const isGlassOn = (doc: Document = document): boolean => doc.documentElement.hasAttribute(GLASS_ATTR);
export const isLiquid = (doc: Document = document): boolean => doc.documentElement.getAttribute(GLASS_ATTR) === "v2";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [GLASS_ATTR] });
  return () => observer.disconnect();
}

/** True while the new skin applies to the current route (R-LG2 structure branches). */
export function useLiquid(): boolean {
  return useSyncExternalStore(subscribe, () => isLiquid(), () => false);
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/lib/glass-flag.test.ts src/architecture.test.ts` — green.
- [ ] **Step 5:** Commit `feat(web): liquid glass dev switch and route pins`.

---

## Task L0-2: `GlassRoutePin` in the shell, switch in `main.tsx`

**Files:** Create `web/src/layout/glass-route-pin.tsx`, `web/src/layout/glass-route-pin.test.tsx`; Modify
`web/src/layout/app-shell.tsx`, `web/src/main.tsx`.

- [ ] **Step 1 (test):** Write `web/src/layout/glass-route-pin.test.tsx`:
```tsx
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { GLASS_ATTR } from "~/lib/glass-flag";
import { GlassRoutePin } from "./glass-route-pin";

let go: (path: string) => void = () => {};
function Nav() {
  const navigate = useNavigate();
  go = navigate;
  return null;
}
const attr = () => document.documentElement.getAttribute(GLASS_ATTR);

describe("GlassRoutePin (plan 2026-10-15-liquid-glass R-L0-2)", () => {
  afterEach(() => document.documentElement.removeAttribute(GLASS_ATTR));

  it("pins locked routes and unpins on leave and on unmount", () => {
    document.documentElement.setAttribute(GLASS_ATTR, "v2");
    const ui = render(
      <MemoryRouter initialEntries={["/library"]}>
        <Nav />
        <Routes><Route path="*" element={<GlassRoutePin />} /></Routes>
      </MemoryRouter>,
    );
    expect(attr()).toBe("pin");
    act(() => go("/practice"));
    expect(attr()).toBe("v2");
    act(() => go("/practice/changelog"));
    expect(attr()).toBe("pin");
    ui.unmount();
    expect(attr()).toBe("v2");
  });

  it("does nothing while the switch is off", () => {
    render(<MemoryRouter initialEntries={["/library"]}><GlassRoutePin /></MemoryRouter>);
    expect(document.documentElement.hasAttribute(GLASS_ATTR)).toBe(false);
  });
});
```
- [ ] **Step 2:** Write `web/src/layout/glass-route-pin.tsx`:
```tsx
import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { isPinnedPath, setGlassPinned } from "~/lib/glass-flag";

/** Locked routes (library, changelog) keep the classic skin of shared components (plan 2026-10-15-liquid-glass R-LG3). */
export function GlassRoutePin() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    setGlassPinned(isPinnedPath(pathname));
  }, [pathname]);
  useLayoutEffect(() => () => setGlassPinned(false), []);
  return null;
}
```
- [ ] **Step 3:** Edit `web/src/layout/app-shell.tsx`:
  1. Single line `import { BottomNav } from "./bottom-nav";` → that line + `import { GlassRoutePin } from "./glass-route-pin";`.
  2. Single line `      <div className="relative flex flex-col bg-background" style={{ height: "var(--app-height, 100dvh)" }}>`
     → `      <div className="page-bg relative flex flex-col bg-background" style={{ height: "var(--app-height, 100dvh)" }}>`.
  3. Single line `        <ScrollRootProvider value={scrollRoot}>` → two lines:
```tsx
        <GlassRoutePin />
        <ScrollRootProvider value={scrollRoot}>
```
  4. Append to the JSDoc above `AppShell` one line: ` * 液态玻璃(计划 2026-10-15-liquid-glass):外壳画 page-bg(只在 html[data-glass="v2"] 下生效);GlassRoutePin 给跟读库 / 更新日志路由钉回经典皮肤。`
- [ ] **Step 4:** Edit `web/src/main.tsx`:
  1. Single line `import { initGlassQuality } from "./layout/glass-quality";` → that line + `import { initGlassFlag } from "./lib/glass-flag";`.
  2. Single line `initGlassQuality();` → two lines `initGlassFlag(); // 液态玻璃开发开关(?glass=v2),默认关(计划 2026-10-15-liquid-glass)` + `initGlassQuality();`.
- [ ] **Step 5:** Run `cd web && yarn vitest run src/layout src/architecture.test.ts` — green (`layout.test.tsx`,
  `app-shell-shadow.test.tsx`, `app-height-coexist.test.tsx` unchanged).
- [ ] **Step 6:** Commit `feat(web): pin locked routes to the classic skin`.

---

## Task L0-3: tokens in `theme.css` + `liquid-tokens.test.ts`

**Files:** Modify `web/src/styles/theme.css`; Create `web/src/styles/liquid-tokens.test.ts`.

- [ ] **Step 1 (test):** Write `web/src/styles/liquid-tokens.test.ts`:
```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* Same block parser as theme.test.ts (first top-level :root / .dark block). */
const css = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8");
function tokens(selector: ":root" | ".dark"): Record<string, string> {
  const block = css.match(new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const root = tokens(":root");
const dark = tokens(".dark");

const PAIRED = [
  "--graphite", "--on-graphite", "--ink-wash", "--ink-wash-2", "--plate", "--scrim",
  "--page-top", "--page-bottom", "--page-flat", "--page-sheen", "--page-grain",
  "--mat-1-rgb", "--mat-2-rgb", "--mat-3-rgb", "--mat-rim-rgb",
  "--mat-1-alpha", "--mat-1s-alpha", "--mat-2-alpha", "--mat-2-bar-alpha", "--mat-3-alpha",
  "--mat-2-filter", "--mat-2-bar-filter", "--mat-3-filter",
  "--mat-rim-1", "--mat-rim-2", "--mat-rim-3", "--mat-hi", "--mat-sh-1", "--mat-sh-2", "--mat-sh-3",
];

const lum = ([r, g, b]: number[]) => {
  const l = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const nums = (v: string) => (v.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

describe("liquid glass tokens (plan 2026-10-15-liquid-glass INDEX §5.1)", () => {
  it.each([[":root", root], [".dark", dark]] as const)("%s defines every paired token", (_, set) => {
    for (const name of PAIRED) expect(set, name).toHaveProperty(name);
  });

  it("keeps the scalars on :root only", () => {
    expect(root["--gx-radius"]).toBe("1");
    expect(root["--frame-x"]).toBe("12px");
    expect(dark).not.toHaveProperty("--gx-radius");
  });

  it("uses the 磨砂 defaults from the v2 mockup", () => {
    expect([root["--mat-1-alpha"], root["--mat-2-alpha"], root["--mat-2-bar-alpha"], root["--mat-3-alpha"]]).toEqual([".70", ".62", ".74", ".68"]);
    expect([dark["--mat-1-alpha"], dark["--mat-2-alpha"], dark["--mat-2-bar-alpha"], dark["--mat-3-alpha"]]).toEqual([".055", ".58", ".70", ".64"]);
    expect(root["--mat-2-filter"]).toBe("blur(24px) saturate(1.6)");
    expect(root["--mat-3-filter"]).toBe("blur(32px) saturate(1.6)");
    expect(root["--plate"]).toBe("rgba(255, 255, 255, 0.9)");
    expect(dark["--plate"]).toBe("rgba(23, 25, 30, 0.9)");
  });

  it("keeps ink-2 at AA on the worse end of the default page gradient", () => {
    expect(contrast([91, 97, 112], nums(root["--page-bottom"]))).toBeGreaterThanOrEqual(4.5);
    expect(contrast([166, 171, 184], nums(dark["--page-top"]))).toBeGreaterThanOrEqual(4.5);
  });

  it("text on graphite stays readable", () => {
    expect(contrast(nums(root["--on-graphite"]), nums(root["--graphite"]))).toBeGreaterThanOrEqual(7);
    expect(contrast(nums(dark["--on-graphite"]), nums(dark["--graphite"]))).toBeGreaterThanOrEqual(7);
  });

  it("does not change any existing token value (pins, R-LG3)", () => {
    expect(root["--bg"]).toBe("255 255 255");
    expect(root["--blue"]).toBe("36 86 219");
    expect(root["--glass-float"]).toBe("rgba(255, 255, 255, 0.1)");
    expect(root["--radius"]).toBe("12px");
  });
});
```
- [ ] **Step 2:** Run it — fails (tokens missing).
- [ ] **Step 3:** Edit `web/src/styles/theme.css`, light block: single line `  --lookup-scrim: rgba(17, 19, 24, 0.14);` (the
  **first** occurrence, inside `:root`) → that line followed by:
```css
  /* 液态玻璃(计划 2026-10-15-liquid-glass INDEX §5.1;只被 html[data-glass="v2"] 下的规则读取) */
  --graphite: 34 37 43;
  --on-graphite: 255 255 255;
  --ink-wash: rgba(17, 19, 24, 0.05);
  --ink-wash-2: rgba(17, 19, 24, 0.09);
  --plate: rgba(255, 255, 255, 0.9);
  --scrim: rgba(17, 19, 24, 0.24);
  --page-top: rgb(246, 247, 248);
  --page-bottom: rgb(232, 234, 237);
  --page-flat: rgb(240, 242, 244);
  --page-sheen: rgba(255, 255, 255, 0.85);
  --page-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .1 0 0 0 0 .1 0 0 0 0 .12 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  --mat-1-rgb: 255 255 255;
  --mat-2-rgb: 255 255 255;
  --mat-3-rgb: 255 255 255;
  --mat-rim-rgb: 255 255 255;
  --mat-1-alpha: .70;
  --mat-1s-alpha: .86;
  --mat-2-alpha: .62;
  --mat-2-bar-alpha: .74;
  --mat-3-alpha: .68;
  --mat-2-filter: blur(24px) saturate(1.6);
  --mat-2-bar-filter: blur(24px) saturate(1.3);
  --mat-3-filter: blur(32px) saturate(1.6);
  --mat-rim-1: .85;
  --mat-rim-2: .60;
  --mat-rim-3: .70;
  --mat-hi: .9;
  --mat-sh-1: 0 1px 1px rgba(17, 19, 24, 0.03), 0 12px 32px -18px rgba(17, 19, 24, 0.16);
  --mat-sh-2: 0 18px 40px -16px rgba(17, 19, 24, 0.24);
  --mat-sh-3: 0 24px 48px -16px rgba(17, 19, 24, 0.4);
  --gx-radius: 1;
  --frame-x: 12px;
```
  Dark block: single line `  --lookup-scrim: rgba(0, 0, 0, 0.34);` → that line followed by the same names **without**
  `--gx-radius` / `--frame-x`, values:
```css
  --graphite: 233 235 239;
  --on-graphite: 17 19 24;
  --ink-wash: rgba(255, 255, 255, 0.06);
  --ink-wash-2: rgba(255, 255, 255, 0.1);
  --plate: rgba(23, 25, 30, 0.9);
  --scrim: rgba(0, 0, 0, 0.5);
  --page-top: rgb(20, 22, 26);
  --page-bottom: rgb(9, 10, 11);
  --page-flat: rgb(16, 17, 20);
  --page-sheen: rgba(255, 255, 255, 0.04);
  --page-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .05 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  --mat-1-rgb: 255 255 255;
  --mat-2-rgb: 28 30 36;
  --mat-3-rgb: 24 26 32;
  --mat-rim-rgb: 255 255 255;
  --mat-1-alpha: .055;
  --mat-1s-alpha: .085;
  --mat-2-alpha: .58;
  --mat-2-bar-alpha: .70;
  --mat-3-alpha: .64;
  --mat-2-filter: blur(24px) saturate(1.6);
  --mat-2-bar-filter: blur(24px) saturate(1.3);
  --mat-3-filter: blur(32px) saturate(1.6);
  --mat-rim-1: .10;
  --mat-rim-2: .12;
  --mat-rim-3: .14;
  --mat-hi: .08;
  --mat-sh-1: 0 12px 32px -18px rgba(0, 0, 0, 0.55);
  --mat-sh-2: 0 18px 44px -14px rgba(0, 0, 0, 0.65);
  --mat-sh-3: 0 24px 48px -16px rgba(0, 0, 0, 0.7);
```
  (Page colours = `hsl(220,14%,97/92/95)` and `hsl(225,12%,9/4/7)`, the mockup's default 雾灰 / 石墨 swatches with top = L+2,
  bottom = L−3; L1's `computeGlassVars` must reproduce them exactly.)
- [ ] **Step 4:** Run `cd web && yarn vitest run src/styles` — green (`theme.test.ts` unchanged and green: it only checks
  its own lists and the first `:root`/`.dark` blocks).
- [ ] **Step 5:** Commit `feat(web): liquid glass tokens`.

---

## Task L0-4: Tailwind variant + theme additions + `cn` + compile test

**Files:** Modify `web/tailwind.config.cjs`, `web/src/lib/cn.ts`, `web/src/lib/cn.test.ts`; Create `web/src/styles/liquid-variant.test.ts`.

- [ ] **Step 1 (test):** Write `web/src/styles/liquid-variant.test.ts`:
```ts
// @vitest-environment node
import { createRequire } from "node:module";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../../tailwind.config.cjs");

async function compile(classes: string): Promise<string> {
  const result = await postcss([
    tailwindcss({ ...config, content: [{ raw: `<div class="${classes}"></div>` }], corePlugins: { ...config.corePlugins, preflight: false } }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

describe("liquid: variant and tokens (plan 2026-10-15-liquid-glass INDEX §4.2, §5.2)", () => {
  it("scopes liquid: utilities under html[data-glass=v2] and emits them after plain and dark: utilities", async () => {
    const css = await compile("bg-surface dark:bg-surface-2 hover:bg-surface-2 liquid:bg-wash liquid:active:bg-wash-2");
    expect(css).toMatch(/\.liquid\\:bg-wash:is\(\[data-glass="v2"\] \*\)/);
    const at = (needle: string) => css.indexOf(needle);
    expect(at(".liquid\\:bg-wash")).toBeGreaterThan(at(".bg-surface"));
    expect(at(".liquid\\:bg-wash")).toBeGreaterThan(at("dark\\:bg-surface-2"));
    expect(at(".liquid\\:bg-wash")).toBeGreaterThan(at("hover\\:bg-surface-2"));
    expect(css).toMatch(/\.liquid\\:active\\:bg-wash-2:active:is\(\[data-glass="v2"\] \*\)|\.liquid\\:active\\:bg-wash-2:is\(\[data-glass="v2"\] \*\):active/);
  });

  it("radii scale with --gx-radius except the bubble tail", async () => {
    const css = await compile("rounded-panel rounded-tile rounded-float rounded-sheet-xl rounded-dialog rounded-field rounded-inset rounded-tr-tail");
    expect(css).toContain("calc(26px * var(--gx-radius, 1))");
    expect(css).toContain("calc(22px * var(--gx-radius, 1))");
    expect(css).toContain("calc(32px * var(--gx-radius, 1))");
    expect(css).toContain("calc(30px * var(--gx-radius, 1))");
    expect(css).toContain("calc(20px * var(--gx-radius, 1))");
    expect(css).toContain("max(10px, calc(26px * var(--gx-radius, 1) - 12px))");
    expect(css).toMatch(/border-top-right-radius:\s*8px/);
  });

  it("has the colour, spacing, shadow and type tokens", async () => {
    const css = await compile("bg-wash bg-wash-2 bg-graphite text-on-graphite bg-plate px-frame shadow-well shadow-e1 shadow-accent text-large");
    expect(css).toContain("var(--ink-wash)");
    expect(css).toContain("var(--ink-wash-2)");
    expect(css).toContain("rgb(var(--graphite)");
    expect(css).toContain("var(--plate)");
    expect(css).toContain("padding-left: 12px");
    expect(css).toContain("inset 0 0 0 .5px var(--hair-2)");
    expect(css).toContain("var(--mat-sh-1)");
    expect(css).toMatch(/font-size:\s*30px/);
  });
});
```
- [ ] **Step 2:** Run it — fails.
- [ ] **Step 3:** Edit `web/tailwind.config.cjs`:
  1. Single line `const noopPlugin = webRequire("tailwindcss/plugin")(() => {});` → that line and:
```js
/** 液态玻璃皮肤(计划 2026-10-15-liquid-glass INDEX §4.2):liquid:x 只在 html[data-glass="v2"] 下生效,且排在普通与 dark: 工具类之后。 */
const liquidVariant = webRequire("tailwindcss/plugin")(({ addVariant }) => {
  addVariant("liquid", '&:is([data-glass="v2"] *)');
});
/** 圆角随用户的「圆角」倍数缩放(--gx-radius,0.5–1.3);胶囊与圆形不缩放 */
const gx = (px) => `calc(${px}px * var(--gx-radius, 1))`;
```
  2. Single line `  red: { DEFAULT: rgb("red"), tint: "var(--red-tint)", solid: rgb("red-solid") },` → that line and:
```js
  // 液态玻璃(计划 2026-10-15-liquid-glass INDEX §5.2)
  wash: { DEFAULT: "var(--ink-wash)", 2: "var(--ink-wash-2)" },
  graphite: rgb("graphite"),
  "on-graphite": rgb("on-graphite"),
  plate: "var(--plate)",
  scrim: "var(--scrim)",
```
  3. Single line `        hero: ["34px", { lineHeight: "1", letterSpacing: "-0.03em" }],` → that line and
     `        large: ["30px", { lineHeight: "1.15", letterSpacing: "-0.025em", fontWeight: "700" }],`.
  4. Single line `        dock: "28px",` → that line and:
```js
        // 液态玻璃:分区 26、小卡 / 气泡 22、悬浮输入条 26、底部弹层 32、对话框 30、多行输入 20、面板内井;tail = 气泡尖角 8(不缩放)
        panel: gx(26),
        tile: gx(22),
        float: gx(26),
        "sheet-xl": gx(32),
        dialog: gx(30),
        field: gx(20),
        inset: "max(10px, calc(26px * var(--gx-radius, 1) - 12px))",
        tail: "8px",
```
  5. Single line `      spacing: { tap: "44px", row: "56px", gutter: "16px", section: "22px", key: "52px" },` →
     `      spacing: { tap: "44px", row: "56px", gutter: "16px", section: "22px", key: "52px", frame: "12px" },`.
  6. Single line `        seg: "0 1px 2px rgba(17, 19, 24, 0.08)",` → that line and:
```js
        well: "inset 0 0 0 .5px var(--hair-2)",
        plate: "inset 0 0 0 .5px var(--hair-2), inset 0 1px 2px rgba(17, 19, 24, .06)",
        e1: "var(--mat-sh-1)",
        e2: "var(--mat-sh-2)",
        e3: "var(--mat-sh-3)",
        accent: "0 8px 20px -12px rgb(var(--blue))",
```
  7. Single line `  ...enjoy,` stays; single line `  content: [` → two lines
     `  plugins: [...(enjoy.plugins ?? []), liquidVariant],` + `  content: [`.
     (Read the file first: if `enjoy.plugins` contains the vidstack plugin reference, it is already the `noopPlugin`
     substitute via `loadEnjoyConfig`; keep it.)
- [ ] **Step 4:** Edit `web/src/lib/cn.ts`: single line
  `export const FONT_SIZE_TOKENS = ["label", "meta", "sub", "body", "title", "headline", "stat", "hero"];` →
  `export const FONT_SIZE_TOKENS = ["label", "meta", "sub", "body", "title", "headline", "stat", "hero", "large"];`.
  Edit `web/src/lib/cn.test.ts`: append inside the existing `describe` (Read it first; before its closing `});`):
```ts
  it("treats text-large as a font size, not a colour (plan 2026-10-15-liquid-glass)", () => {
    expect(cn("text-large", "text-ink")).toBe("text-large text-ink");
  });
```
- [ ] **Step 5:** Run `cd web && yarn vitest run src/styles/liquid-variant.test.ts src/lib/cn.test.ts src/build` — green.
  If the selector string differs only in escaping/ordering of pseudo-classes, fix the **regex in the test**, never the
  variant definition; if `liquid:` utilities are emitted *before* `dark:` ones, stop and report (INDEX K1).
- [ ] **Step 6:** Commit `feat(web): liquid variant and glass tokens in tailwind`.

---

## Task L0-5: material classes in `index.css`, shell background, `glass-budget.test.ts`

**Files:** Modify `web/src/index.css`, `web/src/app.tsx` (one class); Create `web/src/styles/glass-budget.test.ts`.

- [ ] **Step 1 (test):** Write `web/src/styles/glass-budget.test.ts`:
```ts
// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "..");
const css = readFileSync(path.join(SRC, "index.css"), "utf8");
const START = "/* ===== liquid glass (plan 2026-10-15-liquid-glass INDEX §5.3) ===== */";
const END = "/* ===== liquid glass end ===== */";
const section = css.slice(css.indexOf(START), css.indexOf(END));

/** Innermost rules: [selector, body]. Comments stripped; nested @media/@supports are flattened by matching only brace-free bodies. */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = (source: string) =>
  [...strip(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const);
const blurs = (body: string) => /(?:^|[;\s])(?:-webkit-)?backdrop-filter:\s*(?!none)[^;]+;/.test(body);

const BLUR_CLASSES = ["glass", "glass-bar", "glass-float", "glass-pop", "glass-sheet", "mat-chrome", "mat-chrome-bar", "mat-sheet"];
const NEVER_BLUR = ["mat-surface", "mat-surface-strong", "mat-float", "well", "plate", "page-bg"];

/**
 * Files allowed to put a blurring material on an element (INDEX R-LG6). Each later lane appends its own lines here in
 * the same commit that adds the class; anything else fails.
 */
export const BLUR_OWNERS: Record<string, string> = {
  "components/glass-top-bar.tsx": "title capsule (E2)",
  "components/bottom-sheet.tsx": "T3 sheet (transient)",
  "components/glass-tab-bar.tsx": "frozen tab bar (.glass-float)",
  "components/liquid.ts": "LQ_DIALOG constant (T3)",
  "features/lookup/lookup-bar.tsx": "frozen lookup bar (.glass-pop)",
  "features/library": "locked library (own rules)",
  "features/practice/shadow": "locked shadow sheet (own rules)",
  "features/chat/conversation-page.tsx": "classic .glass composer (existing)",
  "features/rooms": "classic .glass composer/docks (existing)",
  "features/wordbook/ui.ts": "classic .glass DOCK (existing)",
  "features/realtime": "classic .glass call dock (existing)",
  "features/rank": "classic .glass match composer (existing)",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("blur budget guards (plan 2026-10-15-liquid-glass INDEX §8)", () => {
  it("has the liquid section, and every rule in it is scoped to html[data-glass=v2]", () => {
    expect(css.indexOf(START)).toBeGreaterThan(0);
    expect(css.indexOf(END)).toBeGreaterThan(css.indexOf(START));
    const selectors = rules(section).map(([sel]) => sel);
    expect(selectors.length).toBeGreaterThan(10);
    for (const sel of selectors) {
      for (const part of sel.split(",")) expect(part.trim(), sel).toMatch(/^html\[data-glass="v2"\]/);
    }
  });

  it("only .glass* and mat-chrome / mat-chrome-bar / mat-sheet ever blur in index.css", () => {
    for (const [sel, body] of rules(css)) {
      if (!blurs(body)) continue;
      for (const part of sel.split(",")) {
        expect(BLUR_CLASSES.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(part)), part).toBe(true);
      }
    }
  });

  it("E1 / well / plate / float / page background never blur", () => {
    for (const [sel, body] of rules(section)) {
      if (!blurs(body)) continue;
      for (const c of NEVER_BLUR) expect(new RegExp(`\\.${c}(?![\\w-])`).test(sel), `${c} in ${sel}`).toBe(false);
    }
  });

  it("solid fallback first, blur only inside @supports, reduced transparency forces solid", () => {
    const supports = section.indexOf("@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))");
    expect(supports).toBeGreaterThan(0);
    expect(section.slice(0, supports)).not.toMatch(/backdrop-filter:\s*var/);
    const reduced = section.slice(section.indexOf("@media (prefers-reduced-transparency: reduce)"));
    expect(reduced).toContain("--plate: rgb(var(--surface));");
    expect(reduced).toMatch(/\.mat-chrome-bar[\s\S]*backdrop-filter: none;/);
  });

  it("only allowlisted files use a blurring material or Tailwind backdrop-blur", () => {
    const offenders = walk(SRC).filter((file) => {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const text = readFileSync(file, "utf8");
      const usesMat = /\bmat-(?:chrome|chrome-bar|sheet)\b/.test(text) || /["'`\s]glass(?:-bar)?["'`\s]/.test(text);
      const usesTw = /\bbackdrop-blur-/.test(text) && rel !== "app.tsx" && rel !== "components/toast-classes.ts";
      const allowed = Object.keys(BLUR_OWNERS).some((k) => rel === k || rel.startsWith(`${k}/`));
      return (usesMat && !allowed) || usesTw;
    });
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
```
  (When the first run lists a pre-existing classic `.glass` user that is missing from `BLUR_OWNERS`, add it with the
  reason "classic .glass (existing)" — that is documentation of the status quo, not a loosening.)
- [ ] **Step 2:** Run it — fails (section missing).
- [ ] **Step 3:** Edit `web/src/index.css`: append at the very end of the file (after the `@media (pointer: coarse)` block,
  outside every `@layer`):
```css

/* ===== liquid glass (plan 2026-10-15-liquid-glass INDEX §5.3) ===== */
/*
 * 液态玻璃材质:只在 html[data-glass="v2"] 下生效(开关关闭或跟读库 / 更新日志路由 = "pin" 时一条都不命中)。
 * 选择器特异度 (0,2,1),压过同元素上的经典工具类(含 dark:)。数值来自 theme.css 的 --mat-* / --page-*,
 * 由用户的「主题自定义」写到 :root(L1)。E1 / 井 / 托板 / 悬浮面板 / 页面背景永远不模糊;只有 mat-chrome、
 * mat-chrome-bar、mat-sheet 模糊(styles/glass-budget.test.ts)。规则 4:模糊层上只放 ≥17px 标题与图标,其余文字放 .plate。
 */
html[data-glass="v2"] .page-bg {
  background: radial-gradient(120% 50% at 50% -10%, var(--page-sheen), transparent 60%),
    linear-gradient(180deg, var(--page-top), var(--page-bottom));
}
html[data-glass="v2"][data-bg="grain"] .page-bg {
  background: var(--page-grain), radial-gradient(120% 50% at 50% -10%, var(--page-sheen), transparent 60%),
    linear-gradient(180deg, var(--page-top), var(--page-bottom));
}
html[data-glass="v2"][data-bg="grain"].lite .page-bg {
  background: radial-gradient(120% 50% at 50% -10%, var(--page-sheen), transparent 60%),
    linear-gradient(180deg, var(--page-top), var(--page-bottom));
}
html[data-glass="v2"][data-bg="solid"] .page-bg {
  background: var(--page-flat);
}
html[data-glass="v2"] .mat-surface {
  background: rgb(var(--mat-1-rgb) / var(--mat-1-alpha));
  border: 1px solid rgb(var(--mat-rim-rgb) / var(--mat-rim-1));
  box-shadow: inset 0 1px 0 rgb(var(--mat-rim-rgb) / var(--mat-hi)), var(--mat-sh-1);
}
html[data-glass="v2"] .mat-surface-strong {
  background: rgb(var(--mat-1-rgb) / var(--mat-1s-alpha));
  border: 1px solid rgb(var(--mat-rim-rgb) / var(--mat-rim-1));
  box-shadow: inset 0 1px 0 rgb(var(--mat-rim-rgb) / var(--mat-hi)), var(--mat-sh-1);
}
html[data-glass="v2"] .mat-float {
  background: rgb(var(--mat-1-rgb) / var(--mat-1s-alpha));
  border: 1px solid rgb(var(--mat-rim-rgb) / var(--mat-rim-1));
  box-shadow: inset 0 1px 0 rgb(var(--mat-rim-rgb) / var(--mat-hi)), var(--mat-sh-2);
}
html[data-glass="v2"].dark .mat-float {
  background: rgba(40, 43, 50, 0.96);
}
html[data-glass="v2"] .well {
  background: var(--ink-wash);
  box-shadow: inset 0 0 0 0.5px var(--hair-2);
}
html[data-glass="v2"] .plate {
  background: var(--plate);
  box-shadow: inset 0 0 0 0.5px var(--hair-2), inset 0 1px 2px rgba(17, 19, 24, 0.06);
}
html[data-glass="v2"] .mat-chrome,
html[data-glass="v2"] .mat-chrome-bar {
  background: var(--glass-solid);
  border: 1px solid rgb(var(--mat-rim-rgb) / var(--mat-rim-2));
  box-shadow: inset 0 1px 0 rgb(var(--mat-rim-rgb) / var(--mat-hi)), var(--mat-sh-2);
}
/* T3:8px 玻璃外框 + 托板内底(规则 4),一个元素画完,内容滚动时托板不动(background-attachment 默认 scroll) */
html[data-glass="v2"] .mat-sheet {
  border: 8px solid transparent;
  background: linear-gradient(var(--plate), var(--plate)) padding-box, var(--glass-solid) border-box;
  box-shadow: 0 0 0 1px rgb(var(--mat-rim-rgb) / var(--mat-rim-3)), var(--mat-sh-3);
}
@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  html[data-glass="v2"] .mat-chrome {
    background: rgb(var(--mat-2-rgb) / var(--mat-2-alpha));
    -webkit-backdrop-filter: var(--mat-2-filter);
    backdrop-filter: var(--mat-2-filter);
  }
  html[data-glass="v2"] .mat-chrome-bar {
    background: rgb(var(--mat-2-rgb) / var(--mat-2-bar-alpha));
    -webkit-backdrop-filter: var(--mat-2-bar-filter);
    backdrop-filter: var(--mat-2-bar-filter);
  }
  html[data-glass="v2"] .mat-sheet {
    background: linear-gradient(var(--plate), var(--plate)) padding-box, rgb(var(--mat-3-rgb) / var(--mat-3-alpha)) border-box;
    -webkit-backdrop-filter: var(--mat-3-filter);
    backdrop-filter: var(--mat-3-filter);
  }
}
@media (prefers-reduced-transparency: reduce) {
  html[data-glass="v2"] {
    --plate: rgb(var(--surface));
  }
  html[data-glass="v2"] .mat-surface,
  html[data-glass="v2"] .mat-surface-strong,
  html[data-glass="v2"] .mat-float,
  html[data-glass="v2"] .mat-chrome,
  html[data-glass="v2"] .mat-chrome-bar {
    background: rgb(var(--surface));
    border-color: var(--hair);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  html[data-glass="v2"] .mat-sheet {
    background: rgb(var(--surface));
    border-color: rgb(var(--surface));
    box-shadow: 0 0 0 1px var(--hair), var(--mat-sh-3);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
/* ===== liquid glass end ===== */
```
  Note: `html[data-glass="v2"] { --plate: … }` inside the media block is the one rule whose selector is exactly the scope;
  the test's `^html\[data-glass="v2"\]` accepts it.
- [ ] **Step 4:** Edit `web/src/app.tsx` (only this line in L0): single line
  `    <div className="flex flex-col bg-background" style={{ height: "var(--app-height, 100dvh)" }}>` →
  `    <div className="page-bg flex flex-col bg-background" style={{ height: "var(--app-height, 100dvh)" }}>`.
- [ ] **Step 5:** Run `cd web && yarn vitest run src/styles src/features/library/library-css.test.ts src/layout src/architecture.test.ts`
  — green (viewport-lock still sees the coarse-pointer rule outside every `@layer`; floating-tab-bar and glass-lookup
  sections are untouched).
- [ ] **Step 6:** Commit `feat(web): liquid glass materials, page background and blur guards`.

---

## Task L0-6: DOM helpers for the lanes (`test/glass.ts`)

**Files:** Create `web/src/test/glass.ts`, `web/src/test/glass.test.tsx`.

- [ ] **Step 1 (test):** Write `web/src/test/glass.test.tsx`:
```tsx
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GLASS_ATTR } from "~/lib/glass-flag";
import { blurLayers, setLiquid, textOutsidePlates } from "./glass";

describe("glass test helpers (plan 2026-10-15-liquid-glass INDEX §8)", () => {
  afterEach(() => setLiquid(false));

  it("setLiquid toggles the attribute", () => {
    setLiquid(true);
    expect(document.documentElement.getAttribute(GLASS_ATTR)).toBe("v2");
    setLiquid(false);
    expect(document.documentElement.hasAttribute(GLASS_ATTR)).toBe(false);
  });

  it("counts blurring layers and finds loose text on them", () => {
    const { container } = render(
      <div>
        <header className="mat-chrome-bar"><h1 data-glass-title>Title</h1><p>loose subtitle</p><span className="sr-only">ok</span></header>
        <div className="mat-chrome"><div className="plate">on a plate</div><svg><text>icon</text></svg></div>
        <div className="mat-surface">no blur</div>
      </div>,
    );
    expect(blurLayers(container)).toHaveLength(2);
    expect(textOutsidePlates(container.querySelector(".mat-chrome-bar")!)).toEqual(["loose subtitle"]);
    expect(textOutsidePlates(container.querySelector(".mat-chrome")!)).toEqual([]);
  });
});
```
- [ ] **Step 2:** Write `web/src/test/glass.ts`:
```ts
import { GLASS_ATTR } from "~/lib/glass-flag";

/** Classes that put a backdrop-filter on an element (INDEX R-LG6). */
export const BLUR_CLASSES = ["glass", "glass-bar", "glass-float", "glass-pop", "glass-sheet", "mat-chrome", "mat-chrome-bar", "mat-sheet"] as const;

/** Tests render pages without the shell: the floating tab bar adds 1, so a page may show at most 2 (+ 1 transient). */
export const PAGE_RESIDENT_MAX = 2;

export function setLiquid(on: boolean, doc: Document = document): void {
  if (on) doc.documentElement.setAttribute(GLASS_ATTR, "v2");
  else doc.documentElement.removeAttribute(GLASS_ATTR);
}

export function blurLayers(root: ParentNode = document): Element[] {
  return Array.from(root.querySelectorAll(BLUR_CLASSES.map((c) => `.${c}`).join(",")));
}

/** Rule 4: visible text on a blurred layer that is not a title, not on a plate (mat-sheet paints its own plate). */
export function textOutsidePlates(el: Element): string[] {
  const out: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const parent = node.parentElement;
    if (!text || !parent) continue;
    if (parent.closest(".plate, .mat-sheet, [data-glass-title], .sr-only, svg")) continue;
    out.push(text);
  }
  return out;
}
```
- [ ] **Step 3:** Run `cd web && yarn vitest run src/test/glass.test.tsx src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `test(web): blur layer and plate helpers`.

---

## Task L0-7: locked-pages guard

**Files:** Create `web/src/styles/locked-pages.test.ts`.

- [ ] **Step 1:** Write `web/src/styles/locked-pages.test.ts`:
```ts
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
  "~/components/announcement-banner", "~/components/bottom-sheet", "~/components/icon-button", "~/components/level-hint",
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
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/styles/locked-pages.test.ts` — green on the first run (the regex was
  checked against the tree while writing). If `KNOWN_SHARED` differs, compare with `git grep` and update the list only if
  the import already existed before this lane (document it in the commit message).
- [ ] **Step 3:** Commit `test(web): guard locked pages against the liquid skin`.

---

## Task L0-8: docs

**Files:** Modify `web/src/styles/CLAUDE.md`, `web/src/layout/CLAUDE.md`, `web/src/lib/CLAUDE.md`.

- [ ] **Step 1:** `web/src/styles/CLAUDE.md`: after the line starting `- Add tokens in both light and dark blocks` add:
```md
- Liquid glass (plan `2026-10-15-liquid-glass`): new tokens (`--graphite`, `--ink-wash*`, `--plate`, `--scrim`, `--page-*`, `--mat-*`, scalars `--gx-radius`, `--frame-x`) are read only by the section at the end of `index.css`, scoped `html[data-glass="v2"]`. Never re-value an existing token (locked pages read them). Guards: `liquid-tokens`, `liquid-variant`, `glass-budget` (blur owners + `BLUR_OWNERS` allowlist), `locked-pages`.
```
- [ ] **Step 2:** `web/src/layout/CLAUDE.md`: in "What lives here" add
  `` - `glass-route-pin.tsx` — `GlassRoutePin` (in `AppShell`): `data-glass="pin"` on `/library*` and `/practice/changelog` so shared components keep the classic skin there (plan `2026-10-15-liquid-glass`). The shell paints `page-bg` (E0 background, liquid only). ``
- [ ] **Step 3:** `web/src/lib/CLAUDE.md`: add
  `` - `glass-flag.ts` — liquid-glass switch: `initGlassFlag` (main.tsx; `?glass=v2` / `?glass=off`, key `enjoy-web.dev.glass`, removed in L12), `isLiquid` / `useLiquid` (structure branches), `isPinnedPath`, `setGlassPinned`. Plan `2026-10-15-liquid-glass`. ``
- [ ] **Step 4:** Run `cd web && yarn vitest run src/styles src/lib src/layout src/test src/architecture.test.ts && cd .. && yarn web:typecheck`.
- [ ] **Step 5:** Commit `docs(web): liquid glass foundation notes`.

## Results to record (implementer fills in, then the controller ticks)

- `liquid-variant.test.ts` actual selector string: ______ ; order vs `dark:` OK? ______
- Pre-existing `.glass` users added to `BLUR_OWNERS`: ______
- Browser smoke (optional, Browser pane, `?glass=v2`): page shows the grey gradient behind the unchanged components;
  `/library` identical to `?glass=off`. UNVERIFIED on devices.
