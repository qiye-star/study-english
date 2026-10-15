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
const MATERIAL_KEYS: readonly Material[] = ["tint", "blur", "saturate", "rim", "shadow"];
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
