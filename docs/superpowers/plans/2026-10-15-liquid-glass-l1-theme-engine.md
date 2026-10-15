# Liquid glass · L1 theme engine (model, contrast guard, store, CSS-variable writer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` §4.3 (API, FROZEN), §4.4 (schema, defaults, presets, swatches), R-LG7–R-LG9.
> Starts after **L0** is merged; runs in parallel with **L2** (disjoint files).

**Goal:** the user-tunable glass: a pure model that clamps prefs, applies presets, computes every `--mat-*` / `--gx-radius` /
`--page-*` value with the accessibility floors, lite caps and the background contrast guard; a tiny store with the
`useGlassTheme()` hook (device-local, debounced persistence, cleared at logout); and a DOM writer that applies the values on
`<html>` before the first render and re-applies on colour-mode / lite changes, throttled to one write per animation frame.

**Architecture:** `lib/glass-theme.ts` is pure (no DOM, no React) and is a straight port of the v2 mockup's `hsl`, `guardColor`,
`mat()` and `PRESETS` (byte-identical in v1/v2). `settings/glass-theme-store.ts` (allowed deps: `lib/`) keeps one in-memory
`GlassTheme`, notifies listeners, writes `localStorage` 300 ms after the last persisted change. `layout/glass-theme.ts` reads
the store, computes for the current `.dark` state and `lite` (device memory OR the user's 减弱), writes inline custom
properties on `document.documentElement` and `data-bg`; `main.tsx` calls `initGlassTheme()` only when the switch is on.

**Tech stack:** TypeScript, React 18 `useSyncExternalStore`, vitest (jsdom, fake timers). No dependency.

## Global Constraints

- Owned files (INDEX §9): `web/src/lib/glass-theme.ts` (+ `.test.ts`), `web/src/settings/glass-theme-store.ts` (+ `.test.ts`),
  `web/src/layout/glass-theme.ts` (+ `.test.ts`), `web/src/layout/glass-quality.ts` (+ `.test.ts`), `web/src/lib/storage.ts`,
  `web/src/auth/device-data.ts` (+ `.test.ts`), `web/src/main.tsx` (one import + one call; L0 already merged its line),
  `web/src/settings/CLAUDE.md`, `web/src/lib/CLAUDE.md`, `web/src/layout/CLAUDE.md` (one line).
- Layering (`architecture.test.ts`, never loosened): `lib/` imports nothing upper; `settings/` → `lib/`; `layout/` →
  `lib/`, `settings/`; `auth/` → `settings/`, `lib/` (allowed: only low layers are restricted).
- Prefs are device-local, never sent anywhere, no logging of values. Logout clears them (`clearDeviceData`).
- With the switch off nothing is written to the DOM (`initGlassTheme` is a no-op) — zero risk for production.
- Worktree `.claude/worktrees/lg-l1`, branch `feat/lg-l1`, junctioned `node_modules`. CRLF: Edit with single-line anchors.
- Tests per task: listed files + `src/architecture.test.ts`; at the end `yarn web:typecheck`. No full suite/build/E2E.
- Commits: `feat(web): …` / `test(web): …`, one per task, own `Co-Authored-By:` line.

## Rulings specific to L1

- **R-L1-1** Stored value = user intent (`tint` factor etc.); computed CSS values are never stored. The UI shows
  `tintToSlider(tint)` (0–100, right = clearer).
- **R-L1-2** Floors/ceilings exactly as the mockup `mat()`: base fills `BASE`, floors `FLOOR`, `+.20` when the tier's blur
  `< 8px`, `≥ .80` for blurred tiers under lite, ceiling `.94` (dark T1 ceiling `.20`). `floorHit` is true when any tier
  was clamped up (the page shows 已到可读下限).
- **R-L1-3** Lite = `deviceMemory ≤ 4` OR `theme.reduced`; lite caps both blurs at 12px and swaps E1 shadows to the 1px
  contact shadow. `prefers-reduced-transparency` is handled in CSS (L0), not here.
- **R-L1-4** Blur 0 writes `none` as the filter (no empty backdrop layer).
- **R-L1-5** Background guard keeps the slot's own ink side (INDEX R-LG8, D-1): light slot raises lightness until
  `ink-2 (#5B6170)` ≥ 4.5:1 against `L − 3` (the gradient bottom); dark slot lowers it until `ink-2 (#A6ABB8)` ≥ 4.5:1 against
  `L + 2` (the top). Saturation is capped at 30. The optional second colour is a swatch of the same mode, guarded the same way.
- **R-L1-6** `reset()` restores `GLASS_DEFAULTS` and removes the storage key.

---

## Task L1-1: the pure model `lib/glass-theme.ts`

**Files:** Create `web/src/lib/glass-theme.ts`, `web/src/lib/glass-theme.test.ts`.

- [ ] **Step 1 (test):** Write `web/src/lib/glass-theme.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  GLASS_DEFAULTS, GLASS_PRESETS, SAT_CAP, SWATCHES, computeGlassVars, contrastRatio, guardBackground, hslToRgb,
  parseGlassTheme, sliderToTint, tintToSlider, withBg, withPatch, withPreset, type GlassTheme,
} from "./glass-theme";

const n = (v: string) => Number(v);
const INK2 = { light: [91, 97, 112] as const, dark: [166, 171, 184] as const };

describe("glass theme model (plan 2026-10-15-liquid-glass L1, INDEX §4.3–4.4)", () => {
  it("parses missing/corrupt storage to the defaults and clamps field by field", () => {
    expect(parseGlassTheme(null)).toEqual(GLASS_DEFAULTS);
    expect(parseGlassTheme({ v: 2 })).toEqual(GLASS_DEFAULTS);
    const t = parseGlassTheme({
      v: 1, preset: "weird", tint: 9, blur: -1, saturate: "x", radius: 2, rim: 0.5, shadow: 1.2, bgStyle: "grain", reduced: "yes",
      bg: { light: { swatch: 99, h: 400, s: 80, l: -5, second: 3 }, dark: "nope" },
    });
    expect(t.preset).toBe("frosted");
    expect([t.tint, t.blur, t.saturate, t.radius, t.rim, t.shadow]).toEqual([1.35, 0, 1.6, 1.3, 0.5, 1.2]);
    expect(t.bgStyle).toBe("grain");
    expect(t.reduced).toBe(false);
    expect(t.bg.light).toEqual({ swatch: 0, h: 360, s: SAT_CAP, l: 0, second: 3 });
    expect(t.bg.dark).toEqual(GLASS_DEFAULTS.bg.dark);
  });

  it("maps the transparency slider (right = clearer) to the tint factor", () => {
    expect(tintToSlider(1)).toBeCloseTo(43.75);
    expect(sliderToTint(0)).toBeCloseTo(1.35);
    expect(sliderToTint(100)).toBeCloseTo(0.55);
    expect(sliderToTint(tintToSlider(0.7))).toBeCloseTo(0.7);
  });

  it("applies presets without touching radius, lite or background, and round-trips to 磨砂", () => {
    const custom: GlassTheme = { ...GLASS_DEFAULTS, radius: 0.6, reduced: true };
    const clear = withPreset(custom, "clear");
    expect(clear).toMatchObject({ preset: "clear", tint: 0.7, blur: 1.25, saturate: 1.8, rim: 1.3, shadow: 0.8, radius: 0.6, reduced: true });
    const solid = withPreset(clear, "solid");
    expect(solid).toMatchObject({ tint: 1.35, blur: 0, saturate: 1, rim: 0.6, shadow: 1, bgStyle: "solid" });
    const back = withPreset(solid, "frosted");
    expect(back).toMatchObject({ ...GLASS_PRESETS.frosted, preset: "frosted", radius: 0.6 });
    expect(back.bg).toEqual(GLASS_DEFAULTS.bg);
  });

  it("a material change makes the preset custom; radius / bgStyle / reduced do not", () => {
    expect(withPatch(GLASS_DEFAULTS, { blur: 1.1 }).preset).toBe("custom");
    expect(withPatch(GLASS_DEFAULTS, { radius: 1.25 }).preset).toBe("frosted");
    expect(withPatch(GLASS_DEFAULTS, { bgStyle: "grain", reduced: true }).preset).toBe("frosted");
    expect(withPatch(GLASS_DEFAULTS, { tint: 5 }).tint).toBe(1.35);
  });

  it("swatch picks copy the swatch; custom colour clears it and caps saturation", () => {
    const sw = withBg(GLASS_DEFAULTS, "light", { swatch: 3 });
    expect(sw.bg.light).toMatchObject({ swatch: 3, h: 45, s: 30, l: 96 });
    const custom = withBg(sw, "light", { s: 70 });
    expect(custom.bg.light).toMatchObject({ swatch: null, h: 45, s: SAT_CAP, l: 96 });
    expect(custom.bg.dark).toEqual(GLASS_DEFAULTS.bg.dark);
  });

  it("all 16 swatches pass the guard unclamped and keep ink-2 at AA on the worse end", () => {
    for (const mode of ["light", "dark"] as const) {
      SWATCHES[mode].forEach((s, i) => {
        const g = guardBackground({ swatch: i, h: s.h, s: s.s, l: s.l, second: null }, mode);
        expect(g.clampedFrom, `${mode} ${i}`).toBeNull();
        expect(contrastRatio([...INK2[mode]], mode === "light" ? g.bottom : g.top)).toBeGreaterThanOrEqual(4.5);
      });
    }
  });

  it("clamps lightness for a custom colour that breaks AA (hint data)", () => {
    expect(guardBackground({ swatch: null, h: 220, s: 20, l: 55, second: null }, "light")).toMatchObject({ l: 91, clampedFrom: 55 });
    expect(guardBackground({ swatch: null, h: 220, s: 20, l: 55, second: null }, "dark")).toMatchObject({ l: 25, clampedFrom: 55 });
    const two = guardBackground({ swatch: 0, h: 220, s: 14, l: 95, second: 5 }, "light");
    expect(two.top).toEqual(hslToRgb(220, 14, 95));
    expect(two.bottom).toEqual(hslToRgb(215, 25, 92));
  });

  it("defaults reproduce theme.css exactly (磨砂, 雾灰 / 石墨)", () => {
    const light = computeGlassVars(GLASS_DEFAULTS, { dark: false, lite: false }).vars;
    expect([n(light["--mat-1-alpha"]), n(light["--mat-1s-alpha"]), n(light["--mat-2-alpha"]), n(light["--mat-2-bar-alpha"]), n(light["--mat-3-alpha"])])
      .toEqual([0.7, 0.86, 0.62, 0.74, 0.68]);
    expect(light["--mat-2-filter"]).toBe("blur(24px) saturate(1.6)");
    expect(light["--mat-2-bar-filter"]).toBe("blur(24px) saturate(1.3)");
    expect(light["--mat-3-filter"]).toBe("blur(32px) saturate(1.6)");
    expect([light["--page-top"], light["--page-bottom"], light["--page-flat"]]).toEqual(["rgb(246, 247, 248)", "rgb(232, 234, 237)", "rgb(240, 242, 244)"]);
    expect(light["--gx-radius"]).toBe("1");
    const dark = computeGlassVars(GLASS_DEFAULTS, { dark: true, lite: false }).vars;
    expect([n(dark["--mat-1-alpha"]), n(dark["--mat-2-alpha"]), n(dark["--mat-3-alpha"])]).toEqual([0.055, 0.58, 0.64]);
    expect([dark["--page-top"], dark["--page-bottom"], dark["--page-flat"]]).toEqual(["rgb(20, 22, 26)", "rgb(9, 10, 11)", "rgb(16, 17, 20)"]);
  });

  it("no slider combination crosses the floors (R-L1-2)", () => {
    const FLOOR = { light: { a1: 0.5, a2: 0.55, bar: 0.62, a3: 0.62 }, dark: { a1: 0.04, a2: 0.5, bar: 0.58, a3: 0.58 } };
    for (const dark of [false, true]) for (const lite of [false, true]) for (const tint of [0.55, 0.8, 1, 1.35]) for (const blur of [0, 0.2, 1, 1.5]) {
      const mode = dark ? "dark" : "light";
      const v = computeGlassVars({ ...GLASS_DEFAULTS, tint, blur }, { dark, lite }).vars;
      const b2 = lite ? Math.min(12, Math.round(24 * blur)) : Math.round(24 * blur);
      const b3 = lite ? Math.min(12, Math.round(32 * blur)) : Math.round(32 * blur);
      const plus2 = b2 < 8 ? 0.2 : 0;
      const plus3 = b3 < 8 ? 0.2 : 0;
      const liteMin = lite ? 0.8 : 0;
      expect(n(v["--mat-1-alpha"])).toBeGreaterThanOrEqual(FLOOR[mode].a1);
      expect(n(v["--mat-2-alpha"])).toBeGreaterThanOrEqual(Math.max(FLOOR[mode].a2 + plus2, liteMin) - 1e-9);
      expect(n(v["--mat-2-bar-alpha"])).toBeGreaterThanOrEqual(Math.max(FLOOR[mode].bar + plus2, liteMin) - 1e-9);
      expect(n(v["--mat-3-alpha"])).toBeGreaterThanOrEqual(Math.max(FLOOR[mode].a3 + plus3, liteMin) - 1e-9);
      expect(n(v["--mat-2-alpha"])).toBeLessThanOrEqual(Math.max(0.94, FLOOR[mode].a2 + plus2, liteMin) + 1e-9);
    }
  });

  it("reports the floor and caps blur under lite; blur 0 writes none", () => {
    expect(computeGlassVars({ ...GLASS_DEFAULTS, tint: 0.55 }, { dark: false, lite: false }).floorHit).toBe(true);
    expect(computeGlassVars(GLASS_DEFAULTS, { dark: false, lite: false }).floorHit).toBe(false);
    const lite = computeGlassVars({ ...GLASS_DEFAULTS, blur: 1.5 }, { dark: false, lite: true }).vars;
    expect(lite["--mat-2-filter"]).toBe("blur(12px) saturate(1.6)");
    expect(lite["--mat-3-filter"]).toBe("blur(12px) saturate(1.6)");
    expect(lite["--mat-sh-1"]).toBe("0 1px 1px rgba(17, 19, 24, 0.05)");
    const none = computeGlassVars({ ...GLASS_DEFAULTS, blur: 0 }, { dark: false, lite: false }).vars;
    expect([none["--mat-2-filter"], none["--mat-2-bar-filter"], none["--mat-3-filter"]]).toEqual(["none", "none", "none"]);
  });

  it("saturation for the title bar is capped at 1.3 and radius is written as-is", () => {
    const v = computeGlassVars({ ...GLASS_DEFAULTS, saturate: 2, radius: 0.6 }, { dark: false, lite: false }).vars;
    expect(v["--mat-2-filter"]).toBe("blur(24px) saturate(2)");
    expect(v["--mat-2-bar-filter"]).toBe("blur(24px) saturate(1.3)");
    expect(v["--gx-radius"]).toBe("0.6");
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/lib/glass-theme.test.ts` — fails (module missing).
- [ ] **Step 3:** Write `web/src/lib/glass-theme.ts`:
```ts
/**
 * 液态玻璃「主题自定义」的纯模型(计划 2026-10-15-liquid-glass INDEX §4.3–§4.4,来源:liquid-glass-v2/mockup.html 的
 * hsl / guardColor / mat / PRESETS / SW)。存的是用户意图(倍数),写到 CSS 的是算出来的值;可读下限在这里统一施加。
 * 不碰 DOM、不依赖 React。
 */
export type GlassPreset = "clear" | "frosted" | "solid" | "custom";
export type BgStyle = "gradient" | "grain" | "solid";
export type ColorMode = "light" | "dark";
export type Rgb = [number, number, number];

export interface BgPref { swatch: number | null; h: number; s: number; l: number; second: number | null }
export interface GlassTheme {
  v: 1;
  preset: GlassPreset;
  tint: number;
  blur: number;
  saturate: number;
  radius: number;
  rim: number;
  shadow: number;
  bgStyle: BgStyle;
  reduced: boolean;
  bg: Record<ColorMode, BgPref>;
}
export type GlassPatch = Partial<Pick<GlassTheme, "tint" | "blur" | "saturate" | "radius" | "rim" | "shadow" | "bgStyle" | "reduced">>;
export interface Swatch { zh: string; en: string; h: number; s: number; l: number }

export const SAT_CAP = 30;
export const GLASS_RANGES = {
  tint: [0.55, 1.35], blur: [0, 1.5], saturate: [1, 2], radius: [0.5, 1.3], rim: [0, 1.5], shadow: [0, 1.5],
} as const;
type Material = keyof typeof GLASS_RANGES;
const MATERIAL_KEYS: readonly Material[] = ["tint", "blur", "saturate", "rim", "shadow"] as const satisfies readonly Material[];
const PRESETS = ["clear", "frosted", "solid", "custom"] as const;
const BG_STYLES = ["gradient", "grain", "solid"] as const;

export const SWATCHES: Record<ColorMode, readonly Swatch[]> = {
  light: [
    { zh: "雾灰", en: "Mist", h: 220, s: 14, l: 95 }, { zh: "暖灰", en: "Warm grey", h: 35, s: 12, l: 93 },
    { zh: "冷灰", en: "Cool grey", h: 210, s: 18, l: 93 }, { zh: "纸白", en: "Paper", h: 45, s: 30, l: 96 },
    { zh: "鼠尾草", en: "Sage", h: 110, s: 12, l: 91 }, { zh: "雾蓝", en: "Haze blue", h: 215, s: 25, l: 92 },
    { zh: "藕粉", en: "Lotus", h: 350, s: 18, l: 93 }, { zh: "燕麦", en: "Oat", h: 32, s: 22, l: 89 },
  ],
  dark: [
    { zh: "石墨", en: "Graphite", h: 225, s: 12, l: 7 }, { zh: "暖炭", en: "Warm charcoal", h: 30, s: 8, l: 9 },
    { zh: "冷夜", en: "Cold night", h: 215, s: 20, l: 9 }, { zh: "墨绿", en: "Ink green", h: 150, s: 12, l: 8 },
    { zh: "深海", en: "Deep sea", h: 215, s: 28, l: 11 }, { zh: "酒灰", en: "Wine grey", h: 345, s: 14, l: 10 },
    { zh: "纯黑", en: "Black", h: 0, s: 0, l: 3 }, { zh: "茶褐", en: "Tea brown", h: 25, s: 16, l: 10 },
  ],
};

const swatchBg = (mode: ColorMode, i: number): BgPref => {
  const s = SWATCHES[mode][i];
  return { swatch: i, h: s.h, s: s.s, l: s.l, second: null };
};

export const GLASS_DEFAULTS: GlassTheme = Object.freeze({
  v: 1, preset: "frosted", tint: 1, blur: 1, saturate: 1.6, radius: 1, rim: 1, shadow: 1, bgStyle: "gradient", reduced: false,
  bg: { light: swatchBg("light", 0), dark: swatchBg("dark", 0) },
}) as GlassTheme;

export const GLASS_PRESETS: Record<Exclude<GlassPreset, "custom">, GlassPatch> = {
  clear: { tint: 0.7, blur: 1.25, saturate: 1.8, rim: 1.3, shadow: 0.8 },
  frosted: { tint: 1, blur: 1, saturate: 1.6, rim: 1, shadow: 1 },
  solid: { tint: 1.35, blur: 0, saturate: 1, rim: 0.6, shadow: 1, bgStyle: "solid" },
};
export const RADIUS_PRESETS = { compact: 0.6, standard: 1, round: 1.25 } as const;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const numIn = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
const indexIn = (v: unknown, fallback: number | null): number | null =>
  v === null ? null : Number.isInteger(v) && (v as number) >= 0 && (v as number) < 8 ? (v as number) : fallback;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const cloneDefaults = (): GlassTheme => ({ ...GLASS_DEFAULTS, bg: { light: { ...GLASS_DEFAULTS.bg.light }, dark: { ...GLASS_DEFAULTS.bg.dark } } });

function parseBg(raw: unknown, mode: ColorMode): BgPref {
  const d = GLASS_DEFAULTS.bg[mode];
  if (!isObj(raw)) return { ...d };
  return {
    swatch: indexIn(raw.swatch, d.swatch),
    h: numIn(raw.h, [0, 360], d.h),
    s: numIn(raw.s, [0, SAT_CAP], d.s),
    l: numIn(raw.l, [0, 100], d.l),
    second: indexIn(raw.second, d.second),
  };
}

/** 存储 → 合法的 GlassTheme:缺失 / 损坏 / 越界逐字段夹紧或回落默认(settings/CLAUDE.md 的规则)。 */
export function parseGlassTheme(raw: unknown): GlassTheme {
  if (!isObj(raw) || raw.v !== 1) return cloneDefaults();
  const d = GLASS_DEFAULTS;
  const bg = isObj(raw.bg) ? raw.bg : {};
  return {
    v: 1,
    preset: (PRESETS as readonly unknown[]).includes(raw.preset) ? (raw.preset as GlassPreset) : d.preset,
    tint: numIn(raw.tint, GLASS_RANGES.tint, d.tint),
    blur: numIn(raw.blur, GLASS_RANGES.blur, d.blur),
    saturate: numIn(raw.saturate, GLASS_RANGES.saturate, d.saturate),
    radius: numIn(raw.radius, GLASS_RANGES.radius, d.radius),
    rim: numIn(raw.rim, GLASS_RANGES.rim, d.rim),
    shadow: numIn(raw.shadow, GLASS_RANGES.shadow, d.shadow),
    bgStyle: (BG_STYLES as readonly unknown[]).includes(raw.bgStyle) ? (raw.bgStyle as BgStyle) : d.bgStyle,
    reduced: typeof raw.reduced === "boolean" ? raw.reduced : d.reduced,
    bg: { light: parseBg(bg.light, "light"), dark: parseBg(bg.dark, "dark") },
  };
}

export function withPreset(theme: GlassTheme, preset: Exclude<GlassPreset, "custom">): GlassTheme {
  return { ...theme, ...GLASS_PRESETS[preset], preset };
}

/** 改材质(透明度、模糊、饱和度、边缘高光、阴影)→ 预设变「自定义」;圆角、背景样式、减弱不改预设。 */
export function withPatch(theme: GlassTheme, patch: GlassPatch): GlassTheme {
  const next: GlassTheme = { ...theme };
  let custom = false;
  for (const key of Object.keys(GLASS_RANGES) as Material[]) {
    const v = patch[key];
    if (v === undefined) continue;
    const clamped = numIn(v, GLASS_RANGES[key], theme[key]);
    if (MATERIAL_KEYS.includes(key) && clamped !== theme[key]) custom = true;
    next[key] = clamped;
  }
  if (patch.bgStyle && (BG_STYLES as readonly string[]).includes(patch.bgStyle)) next.bgStyle = patch.bgStyle;
  if (typeof patch.reduced === "boolean") next.reduced = patch.reduced;
  if (custom) next.preset = "custom";
  return next;
}

/** 选色板 → 拷贝色板的 HSL;改 HSL → 变自定义颜色(swatch = null);饱和度上限 30。 */
export function withBg(theme: GlassTheme, mode: ColorMode, patch: Partial<BgPref>): GlassTheme {
  const cur = theme.bg[mode];
  let next: BgPref = { ...cur };
  if (typeof patch.swatch === "number" && SWATCHES[mode][patch.swatch]) next = { ...swatchBg(mode, patch.swatch), second: cur.second };
  if (patch.h !== undefined || patch.s !== undefined || patch.l !== undefined) {
    next = {
      ...next,
      swatch: null,
      h: numIn(patch.h, [0, 360], next.h),
      s: numIn(patch.s, [0, SAT_CAP], next.s),
      l: numIn(patch.l, [0, 100], next.l),
    };
  }
  if (patch.second !== undefined) next.second = indexIn(patch.second, cur.second);
  return { ...theme, bg: { ...theme.bg, [mode]: next } };
}

export const tintToSlider = (tint: number) => (1.35 - tint) / 0.008;
export const sliderToTint = (v: number) => clamp(1.35 - v * 0.008, 0.55, 1.35);

/* ---------- colour ---------- */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const S = s / 100;
  const L = l / 100;
  const a = S * Math.min(L, 1 - L);
  const f = (k0: number) => {
    const k = (k0 + h / 30) % 12;
    return L - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255)) as Rgb;
}
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const INK2: Record<ColorMode, Rgb> = { light: [91, 97, 112], dark: [166, 171, 184] };

function guardL(h: number, s: number, l: number, mode: ColorMode): { l: number; from: number | null } {
  const start = Math.round(l);
  const dir = mode === "light" ? 1 : -1;
  const worst = (L: number) => hslToRgb(h, s, clamp(L + (mode === "light" ? -3 : 2), 0, 100));
  let x = start;
  while (contrastRatio(INK2[mode], worst(x)) < 4.5 && x >= 0 && x <= 100) x += dir;
  x = clamp(x, 0, 100);
  return { l: x, from: x !== start ? start : null };
}

export interface GuardedBg { top: Rgb; bottom: Rgb; flat: Rgb; l: number; clampedFrom: number | null; secondClampedFrom: number | null }

/** 背景可读性守卫(R-L1-5):夹紧亮度直到 ink-2 在渐变较差一端 ≥ 4.5:1;第二颜色是同模式的色板。 */
export function guardBackground(pref: BgPref, mode: ColorMode): GuardedBg {
  const s = Math.min(SAT_CAP, pref.s);
  const g = guardL(pref.h, s, pref.l, mode);
  const flat = hslToRgb(pref.h, s, g.l);
  const second = pref.second === null ? undefined : SWATCHES[mode][pref.second];
  if (second) {
    const g2 = guardL(second.h, second.s, second.l, mode);
    return { top: flat, bottom: hslToRgb(second.h, second.s, g2.l), flat, l: g.l, clampedFrom: g.from, secondClampedFrom: g2.from };
  }
  return {
    top: hslToRgb(pref.h, s, clamp(g.l + 2, 0, 100)),
    bottom: hslToRgb(pref.h, s, clamp(g.l - 3, 0, 100)),
    flat, l: g.l, clampedFrom: g.from, secondClampedFrom: null,
  };
}

/* ---------- materials (mockup mat()) ---------- */
const BASE = { light: { a1: 0.7, a1s: 0.86, a2: 0.62, bar: 0.74, a3: 0.68 }, dark: { a1: 0.055, a1s: 0.085, a2: 0.58, bar: 0.7, a3: 0.64 } };
const FLOOR = { light: { a1: 0.5, a2: 0.55, bar: 0.62, a3: 0.62 }, dark: { a1: 0.04, a2: 0.5, bar: 0.58, a3: 0.58 } };
const CEIL = 0.94;

export interface ComputedGlass { vars: Record<string, string>; floorHit: boolean; bg: GuardedBg; blurPx: { chrome: number; sheet: number } }

const f3 = (x: number) => String(Math.round(x * 1000) / 1000);
const rgbCss = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;
const satCss = (x: number) => String(Math.round(x * 100) / 100);

export function computeGlassVars(theme: GlassTheme, env: { dark: boolean; lite: boolean }): ComputedGlass {
  const mode: ColorMode = env.dark ? "dark" : "light";
  const B = BASE[mode];
  const F = { ...FLOOR[mode] };
  let chrome = Math.round(24 * theme.blur);
  let sheet = Math.round(32 * theme.blur);
  if (env.lite) {
    chrome = Math.min(12, chrome);
    sheet = Math.min(12, sheet);
  }
  if (chrome < 8) { F.a2 += 0.2; F.bar += 0.2; }
  if (sheet < 8) F.a3 += 0.2;
  if (env.lite) { F.a2 = Math.max(F.a2, 0.8); F.bar = Math.max(F.bar, 0.8); F.a3 = Math.max(F.a3, 0.8); }
  let floorHit = false;
  const A = (key: keyof typeof B, floorKey: keyof typeof F) => {
    const v = B[key] * theme.tint;
    const floor = F[floorKey];
    const ceil = mode === "dark" && (key === "a1" || key === "a1s") ? 0.2 : CEIL;
    if (v < floor) floorHit = true;
    return clamp(v, floor, Math.max(ceil, floor));
  };
  const sat = satCss(theme.saturate);
  const satBar = satCss(Math.min(theme.saturate, 1.3));
  const r = theme.rim;
  const k = theme.shadow;
  const light = mode === "light";
  const bg = guardBackground(theme.bg[mode], mode);
  const vars: Record<string, string> = {
    "--mat-1-alpha": f3(A("a1", "a1")),
    "--mat-1s-alpha": f3(A("a1s", "a1")),
    "--mat-2-alpha": f3(A("a2", "a2")),
    "--mat-2-bar-alpha": f3(A("bar", "bar")),
    "--mat-3-alpha": f3(A("a3", "a3")),
    "--mat-2-filter": chrome > 0 ? `blur(${chrome}px) saturate(${sat})` : "none",
    "--mat-2-bar-filter": chrome > 0 ? `blur(${chrome}px) saturate(${satBar})` : "none",
    "--mat-3-filter": sheet > 0 ? `blur(${sheet}px) saturate(${sat})` : "none",
    "--mat-rim-1": f3(light ? clamp(0.85 * r, 0, 1) : clamp(0.1 * r, 0, 0.3)),
    "--mat-rim-2": f3(light ? clamp(0.6 * r, 0, 1) : clamp(0.12 * r, 0, 0.3)),
    "--mat-rim-3": f3(light ? clamp(0.7 * r, 0, 1) : clamp(0.14 * r, 0, 0.3)),
    "--mat-hi": f3(light ? clamp(0.9 * r, 0, 1) : clamp(0.08 * r, 0, 0.25)),
    "--mat-sh-1": light
      ? `0 1px 1px rgba(17, 19, 24, ${f3(0.03 * k)}), 0 12px 32px -18px rgba(17, 19, 24, ${f3(0.16 * k)})`
      : `0 12px 32px -18px rgba(0, 0, 0, ${f3(clamp(0.55 * k, 0, 1))})`,
    "--mat-sh-2": light
      ? `0 18px 40px -16px rgba(17, 19, 24, ${f3(0.24 * k)})`
      : `0 18px 44px -14px rgba(0, 0, 0, ${f3(clamp(0.65 * k, 0, 1))})`,
    "--mat-sh-3": light
      ? `0 24px 48px -16px rgba(17, 19, 24, ${f3(0.4 * k)})`
      : `0 24px 48px -16px rgba(0, 0, 0, ${f3(clamp(0.7 * k, 0, 1))})`,
    "--gx-radius": String(theme.radius),
    "--page-top": rgbCss(bg.top),
    "--page-bottom": rgbCss(bg.bottom),
    "--page-flat": rgbCss(bg.flat),
  };
  if (env.lite) vars["--mat-sh-1"] = light ? "0 1px 1px rgba(17, 19, 24, 0.05)" : "0 1px 1px rgba(0, 0, 0, 0.4)";
  return { vars, floorHit, bg, blurPx: { chrome, sheet } };
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/lib/glass-theme.test.ts src/architecture.test.ts` — green. If a
  floating-point expectation in the "defaults" test fails only in the last digit, compare with `toBeCloseTo`; never change
  `BASE`/`FLOOR`/`CEIL` (they are the approved mockup values).
- [ ] **Step 5:** Commit `feat(web): liquid glass theme model with floors and background guard`.

---

## Task L1-2: storage key, store and `useGlassTheme()`

**Files:** Modify `web/src/lib/storage.ts`; Create `web/src/settings/glass-theme-store.ts`, `web/src/settings/glass-theme-store.test.ts`.

- [ ] **Step 1:** Edit `web/src/lib/storage.ts`: append at the end:
```ts

/** 液态玻璃「主题自定义」的本机偏好(计划 2026-10-15-liquid-glass INDEX §4.4);登出时由 auth/device-data 清除。 */
export const GLASS_THEME_KEY = "enjoy-web.appearance.glass";
```
- [ ] **Step 2 (test):** Write `web/src/settings/glass-theme-store.test.ts`:
```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLASS_DEFAULTS } from "~/lib/glass-theme";
import { GLASS_THEME_KEY } from "~/lib/storage";
import { getGlassTheme, resetGlassThemeMemory, subscribeGlassTheme, useGlassTheme } from "./glass-theme-store";

const stored = () => JSON.parse(window.localStorage.getItem(GLASS_THEME_KEY) ?? "null");

describe("glass theme store (plan 2026-10-15-liquid-glass INDEX §4.3)", () => {
  beforeEach(() => { vi.useFakeTimers(); window.localStorage.removeItem(GLASS_THEME_KEY); resetGlassThemeMemory(); });
  afterEach(() => { vi.useRealTimers(); window.localStorage.removeItem(GLASS_THEME_KEY); resetGlassThemeMemory(); });

  it("reads defaults when nothing or garbage is stored", () => {
    expect(getGlassTheme()).toEqual(GLASS_DEFAULTS);
    window.localStorage.setItem(GLASS_THEME_KEY, "{not json");
    resetGlassThemeMemory();
    expect(getGlassTheme()).toEqual(GLASS_DEFAULTS);
  });

  it("notifies at once and persists 300 ms after the last change", () => {
    const { result } = renderHook(() => useGlassTheme());
    const seen = vi.fn();
    const off = subscribeGlassTheme(seen);
    act(() => result.current.update({ blur: 1.2 }));
    act(() => result.current.update({ blur: 1.3 }));
    expect(result.current.theme.blur).toBe(1.3);
    expect(result.current.theme.preset).toBe("custom");
    expect(seen).toHaveBeenCalledTimes(2);
    expect(stored()).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(stored()).toMatchObject({ v: 1, blur: 1.3, preset: "custom" });
    off();
  });

  it("live drags do not persist; presets, background and reset do", () => {
    const { result } = renderHook(() => useGlassTheme());
    act(() => result.current.update({ tint: 0.8 }, { persist: false }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(stored()).toBeNull();
    act(() => result.current.applyPreset("solid"));
    act(() => result.current.updateBg("dark", { swatch: 6 }));
    act(() => { vi.advanceTimersByTime(300); });
    expect(stored()).toMatchObject({ preset: "solid", bgStyle: "solid", bg: { dark: { swatch: 6, l: 3 } } });
    act(() => result.current.reset());
    expect(result.current.theme).toEqual(GLASS_DEFAULTS);
    expect(window.localStorage.getItem(GLASS_THEME_KEY)).toBeNull();
  });

  it("resetGlassThemeMemory re-reads storage and notifies (logout)", () => {
    window.localStorage.setItem(GLASS_THEME_KEY, JSON.stringify({ ...GLASS_DEFAULTS, radius: 0.6 }));
    resetGlassThemeMemory();
    expect(getGlassTheme().radius).toBe(0.6);
    const seen = vi.fn();
    subscribeGlassTheme(seen);
    window.localStorage.removeItem(GLASS_THEME_KEY);
    resetGlassThemeMemory();
    expect(seen).toHaveBeenCalled();
    expect(getGlassTheme()).toEqual(GLASS_DEFAULTS);
  });
});
```
- [ ] **Step 3:** Write `web/src/settings/glass-theme-store.ts`:
```ts
import { useMemo, useSyncExternalStore } from "react";
import {
  parseGlassTheme, withBg, withPatch, withPreset,
  type BgPref, type ColorMode, type GlassPatch, type GlassPreset, type GlassTheme,
} from "~/lib/glass-theme";
import { GLASS_THEME_KEY, readJson, removeKey, writeJson } from "~/lib/storage";

/**
 * 「主题自定义」的本机存储(计划 2026-10-15-liquid-glass INDEX §4.3):内存里一份 GlassTheme,变化立即通知
 * (layout/glass-theme.ts 在下一帧写 CSS 变量),持久化在最后一次变化 300 ms 后。拖动滑块时传 persist:false,松手再存。
 */
const isObject = (v: unknown): v is object => typeof v === "object" && v !== null;
const PERSIST_MS = 300;

let current: GlassTheme | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

export function getGlassTheme(): GlassTheme {
  if (!current) current = parseGlassTheme(readJson(GLASS_THEME_KEY, isObject));
  return current;
}

export function setGlassTheme(next: GlassTheme, opts: { persist?: boolean } = {}): void {
  current = next;
  notify();
  if (opts.persist === false) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (current) writeJson(GLASS_THEME_KEY, current);
  }, PERSIST_MS);
}

export function subscribeGlassTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 登出(auth/device-data)或测试:丢掉内存副本与待写入,下次从存储重新读,并通知订阅者重新应用。 */
export function resetGlassThemeMemory(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  notify();
}

export interface GlassThemeApi {
  theme: GlassTheme;
  update(patch: GlassPatch, opts?: { persist?: boolean }): void;
  updateBg(mode: ColorMode, patch: Partial<BgPref>, opts?: { persist?: boolean }): void;
  applyPreset(preset: Exclude<GlassPreset, "custom">): void;
  reset(): void;
}

export function useGlassTheme(): GlassThemeApi {
  const theme = useSyncExternalStore(subscribeGlassTheme, getGlassTheme, getGlassTheme);
  return useMemo(() => ({
    theme,
    update: (patch, opts) => setGlassTheme(withPatch(getGlassTheme(), patch), opts),
    updateBg: (mode, patch, opts) => setGlassTheme(withBg(getGlassTheme(), mode, patch), opts),
    applyPreset: (preset) => setGlassTheme(withPreset(getGlassTheme(), preset)),
    reset: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      removeKey(GLASS_THEME_KEY);
      current = parseGlassTheme(null);
      notify();
    },
  }), [theme]);
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/settings/glass-theme-store.test.ts src/lib/storage.test.ts src/architecture.test.ts` — green.
- [ ] **Step 5:** Commit `feat(web): glass theme store and useGlassTheme hook`.

---

## Task L1-3: the writer `layout/glass-theme.ts` + `isLowMemory`

**Files:** Modify `web/src/layout/glass-quality.ts`, `web/src/layout/glass-quality.test.ts`; Create
`web/src/layout/glass-theme.ts`, `web/src/layout/glass-theme.test.ts`.

- [ ] **Step 1:** Replace `web/src/layout/glass-quality.ts` completely:
```ts
/**
 * 低内存设备(navigator.deviceMemory ≤ 4)给 <html> 加 .lite:index.css 里的 .glass* 改用更轻的 blur(12px) 与更高不透明度。
 * 不支持 deviceMemory 的浏览器(Safari)保持完整玻璃。液态玻璃打开时,layout/glass-theme.ts 还会因用户选了「减弱」而加 .lite。
 */
export function isLowMemory(win: Window = window): boolean {
  const memory = (win.navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof memory === "number" && memory <= 4;
}

export function initGlassQuality(win: Window = window): boolean {
  const lite = isLowMemory(win);
  win.document.documentElement.classList.toggle("lite", lite);
  return lite;
}
```
  Edit `web/src/layout/glass-quality.test.ts`: single line `import { initGlassQuality } from "./glass-quality";` →
  `import { initGlassQuality, isLowMemory } from "./glass-quality";`; and before the final `});` add:
```ts
  it("isLowMemory is the same rule without touching the DOM", () => {
    expect(isLowMemory(fakeWindow(4))).toBe(true);
    expect(isLowMemory(fakeWindow(8))).toBe(false);
    expect(document.documentElement.classList.contains("lite")).toBe(false);
  });
```
- [ ] **Step 2 (test):** Write `web/src/layout/glass-theme.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLASS_ATTR } from "~/lib/glass-flag";
import { GLASS_DEFAULTS } from "~/lib/glass-theme";
import { GLASS_THEME_KEY } from "~/lib/storage";
import { resetGlassThemeMemory, setGlassTheme } from "~/settings/glass-theme-store";
import { applyGlassTheme, initGlassTheme } from "./glass-theme";

const root = document.documentElement;
const v = (name: string) => root.style.getPropertyValue(name);
const fakeWin = (deviceMemory?: number): Window =>
  Object.assign(Object.create(window), { navigator: { deviceMemory }, document, requestAnimationFrame: (cb: FrameRequestCallback) => { cb(0); return 1; }, cancelAnimationFrame: () => {} });

describe("glass theme writer (plan 2026-10-15-liquid-glass L1)", () => {
  beforeEach(() => { window.localStorage.removeItem(GLASS_THEME_KEY); resetGlassThemeMemory(); });
  afterEach(() => {
    root.removeAttribute("style");
    root.removeAttribute("data-bg");
    root.removeAttribute(GLASS_ATTR);
    root.classList.remove("lite", "dark");
  });

  it("writes the computed variables and the background style on <html>", () => {
    applyGlassTheme({ ...GLASS_DEFAULTS, bgStyle: "grain" }, fakeWin(8));
    expect(v("--mat-2-filter")).toBe("blur(24px) saturate(1.6)");
    expect(v("--page-top")).toBe("rgb(246, 247, 248)");
    expect(root.getAttribute("data-bg")).toBe("grain");
    expect(root.classList.contains("lite")).toBe(false);
  });

  it("减弱 or a low-memory device forces html.lite and caps blur", () => {
    applyGlassTheme({ ...GLASS_DEFAULTS, reduced: true }, fakeWin(8));
    expect(root.classList.contains("lite")).toBe(true);
    expect(v("--mat-3-filter")).toBe("blur(12px) saturate(1.6)");
    applyGlassTheme(GLASS_DEFAULTS, fakeWin(2));
    expect(root.classList.contains("lite")).toBe(true);
    applyGlassTheme(GLASS_DEFAULTS, fakeWin(8));
    expect(root.classList.contains("lite")).toBe(false);
  });

  it("uses the dark values when html.dark is set", () => {
    root.classList.add("dark");
    applyGlassTheme(GLASS_DEFAULTS, fakeWin(8));
    expect(Number(v("--mat-1-alpha"))).toBeCloseTo(0.055);
    expect(v("--page-bottom")).toBe("rgb(9, 10, 11)");
  });

  it("does nothing while the switch is off", () => {
    const stop = initGlassTheme(fakeWin(8));
    expect(v("--mat-2-filter")).toBe("");
    stop();
  });

  it("applies on init, on store changes and when the colour mode flips", async () => {
    root.setAttribute(GLASS_ATTR, "v2");
    const stop = initGlassTheme(fakeWin(8));
    expect(v("--gx-radius")).toBe("1");
    setGlassTheme({ ...GLASS_DEFAULTS, radius: 0.6 }, { persist: false });
    expect(v("--gx-radius")).toBe("0.6");
    root.classList.add("dark");
    await vi.waitFor(() => expect(v("--page-top")).toBe("rgb(20, 22, 26)"));
    stop();
  });
});
```
- [ ] **Step 3:** Write `web/src/layout/glass-theme.ts`:
```ts
import { isGlassOn } from "~/lib/glass-flag";
import { computeGlassVars, type ComputedGlass, type GlassTheme } from "~/lib/glass-theme";
import { getGlassTheme, subscribeGlassTheme } from "~/settings/glass-theme-store";
import { isLowMemory } from "./glass-quality";

/**
 * 把「主题自定义」写到 <html>(计划 2026-10-15-liquid-glass INDEX §4.3):内联 CSS 变量(--mat-* / --gx-radius / --page-*)、
 * data-bg(渐变 / 颗粒 / 纯色)、.lite(低内存或用户选「减弱」)。降低透明度由 index.css 的媒体查询处理,不在这里。
 */
export function applyGlassTheme(theme: GlassTheme, win: Window = window): ComputedGlass {
  const root = win.document.documentElement;
  const lite = isLowMemory(win) || theme.reduced;
  if (root.classList.contains("lite") !== lite) root.classList.toggle("lite", lite);
  const out = computeGlassVars(theme, { dark: root.classList.contains("dark"), lite });
  for (const [name, value] of Object.entries(out.vars)) root.style.setProperty(name, value);
  root.setAttribute("data-bg", theme.bgStyle);
  return out;
}

/** main.tsx 渲染前调用;开关关闭时什么也不做。之后跟随存储变化与 html.dark 切换,每帧最多写一次。返回清理函数。 */
export function initGlassTheme(win: Window = window): () => void {
  if (!isGlassOn(win.document)) return () => {};
  const raf = win.requestAnimationFrame?.bind(win) ?? ((cb: FrameRequestCallback) => win.setTimeout(() => cb(0), 16));
  const cancel = win.cancelAnimationFrame?.bind(win) ?? ((id: number) => win.clearTimeout(id));
  let frame = 0;
  const apply = () => {
    frame = 0;
    applyGlassTheme(getGlassTheme(), win);
  };
  const schedule = () => {
    if (!frame) frame = raf(apply);
  };
  apply();
  const unsubscribe = subscribeGlassTheme(schedule);
  // .dark 由 color-scheme.ts 切换;我们自己切 .lite 时只在值变化时切,所以不会循环
  const observer = new MutationObserver(schedule);
  observer.observe(win.document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
    unsubscribe();
    observer.disconnect();
    if (frame) cancel(frame);
  };
}
```
- [ ] **Step 4:** Edit `web/src/main.tsx` (after L0 merged): single line `import { initGlassQuality } from "./layout/glass-quality";`
  → that line + `import { initGlassTheme } from "./layout/glass-theme";`; single line `initGlassQuality();` → two lines
  `initGlassQuality();` + `initGlassTheme(); // 主题自定义 → :root 变量(开关打开时;计划 2026-10-15-liquid-glass)`.
- [ ] **Step 5:** Run `cd web && yarn vitest run src/layout/glass-theme.test.ts src/layout/glass-quality.test.ts src/layout src/architecture.test.ts` — green.
- [ ] **Step 6:** Commit `feat(web): apply the glass theme as CSS variables before first render`.

---

## Task L1-4: logout cleanup

**Files:** Modify `web/src/auth/device-data.ts`, `web/src/auth/device-data.test.ts`.

- [ ] **Step 1 (test):** Read `web/src/auth/device-data.test.ts`; add a case in its main `describe` (mirroring the
  existing key assertions):
```ts
  it("clears the glass theme prefs and resets the in-memory copy (plan 2026-10-15-liquid-glass R-LG9)", async () => {
    const { GLASS_THEME_KEY } = await import("~/lib/storage");
    const store = await import("~/settings/glass-theme-store");
    window.localStorage.setItem(GLASS_THEME_KEY, JSON.stringify({ v: 1, radius: 0.6 }));
    store.resetGlassThemeMemory();
    expect(store.getGlassTheme().radius).toBe(0.6);
    clearDeviceData();
    expect(window.localStorage.getItem(GLASS_THEME_KEY)).toBeNull();
    expect(store.getGlassTheme().radius).toBe(1);
  });
```
  (If the file mocks `~/lib/storage`, use `vi.importActual` for `GLASS_THEME_KEY` and assert the mocked `removeKey` was
  called with `"enjoy-web.appearance.glass"` instead.)
- [ ] **Step 2:** Edit `web/src/auth/device-data.ts`:
  1. Single line `import { CHANGELOG_PREFS_KEY, PRACTICE_DRAFT_KEY, WORDBOOK_PREFS_KEY, removeKey } from "~/lib/storage";` →
     `import { CHANGELOG_PREFS_KEY, GLASS_THEME_KEY, PRACTICE_DRAFT_KEY, WORDBOOK_PREFS_KEY, removeKey } from "~/lib/storage";`
     + new line `import { resetGlassThemeMemory } from "~/settings/glass-theme-store";`.
  2. Single line `    removeKey(CHANGELOG_PREFS_KEY);` → that line + `    removeKey(GLASS_THEME_KEY); // 主题自定义也是本机偏好(计划 2026-10-15-liquid-glass)`.
  3. Single line `    resetPlaybackRate(); // R24:语速是本机偏好,随登出清理` → that line + `    resetGlassThemeMemory();`.
  4. JSDoc of `clearDeviceData`: after `背单词偏好、` insert `主题自定义、`.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/auth src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `feat(web): clear glass theme prefs at logout`.

---

## Task L1-5: docs

- [ ] **Step 1:** `web/src/settings/CLAUDE.md` "What lives here": add
  `` - `glass-theme-store.ts`: liquid-glass 主题自定义 store (`getGlassTheme`, `setGlassTheme` with 300 ms persistence, `subscribeGlassTheme`, `resetGlassThemeMemory`, `useGlassTheme()`), key `enjoy-web.appearance.glass`, separate from `enjoy-web.settings`; cleared at logout. Pure maths in `lib/glass-theme.ts`. ``
- [ ] **Step 2:** `web/src/lib/CLAUDE.md`: add
  `` - `glass-theme.ts` — pure liquid-glass model (plan `2026-10-15-liquid-glass`): `parseGlassTheme`, presets, `withPatch` / `withBg`, `computeGlassVars` (floors, lite caps), `guardBackground` (AA lightness clamp), `SWATCHES`. Never relax `BASE` / `FLOOR` / `CEIL`. ``
- [ ] **Step 3:** `web/src/layout/CLAUDE.md`: add
  `` - `glass-theme.ts` — `initGlassTheme` (main.tsx, only when `data-glass` is set) / `applyGlassTheme`: writes the computed vars inline on `<html>`, `data-bg`, `.lite` (device memory or 减弱). ``
- [ ] **Step 4:** Run `cd web && yarn vitest run src/lib src/settings src/layout src/auth src/architecture.test.ts && cd .. && yarn web:typecheck`.
- [ ] **Step 5:** Commit `docs(web): glass theme engine notes`.

## UNVERIFIED / to measure

- Frame cost of rewriting ~20 inline variables per rAF while dragging (every blurred layer repaints) on a low-end Android.
- `prefers-reduced-transparency` support: Chrome yes (flag-free since 118), Safari unknown; when unsupported, the CSS media
  never matches and the sliders still apply.
