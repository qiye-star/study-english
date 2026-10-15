import { describe, expect, it } from "vitest";
import {
  GLASS_DEFAULTS, GLASS_PRESETS, SAT_CAP, SWATCHES, computeGlassVars, contrastRatio, guardBackground, hslToRgb,
  parseGlassTheme, sliderToTint, tintToSlider, withBg, withPatch, withPreset, type GlassTheme, type Rgb,
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
    expect(t.preset).toBe("clear");
    expect([t.tint, t.blur, t.saturate, t.radius, t.rim, t.shadow]).toEqual([1.35, 0, 1.8, 1.3, 0.5, 1.2]);
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
    expect(withPatch(GLASS_DEFAULTS, { radius: 1.25 }).preset).toBe("clear");
    expect(withPatch(GLASS_DEFAULTS, { bgStyle: "grain", reduced: true }).preset).toBe("clear");
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

  it("the 磨砂 preset reproduces the theme.css baseline exactly (雾灰 / 石墨)", () => {
    const frosted = withPreset(GLASS_DEFAULTS, "frosted");
    const light = computeGlassVars(frosted, { dark: false, lite: false }).vars;
    expect([n(light["--mat-1-alpha"]), n(light["--mat-1s-alpha"]), n(light["--mat-2-alpha"]), n(light["--mat-2-bar-alpha"]), n(light["--mat-3-alpha"])])
      .toEqual([0.7, 0.86, 0.62, 0.74, 0.68]);
    expect(light["--mat-2-filter"]).toBe("blur(24px) saturate(1.6)");
    expect(light["--mat-2-bar-filter"]).toBe("blur(24px) saturate(1.3)");
    expect(light["--mat-3-filter"]).toBe("blur(32px) saturate(1.6)");
    expect([light["--page-top"], light["--page-bottom"], light["--page-flat"]]).toEqual(["rgb(246, 247, 248)", "rgb(232, 234, 237)", "rgb(240, 242, 244)"]);
    expect(light["--gx-radius"]).toBe("1");
    const dark = computeGlassVars(frosted, { dark: true, lite: false }).vars;
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
    expect(computeGlassVars(withPreset(GLASS_DEFAULTS, "frosted"), { dark: false, lite: false }).floorHit).toBe(false);
    const lite = computeGlassVars({ ...GLASS_DEFAULTS, blur: 1.5 }, { dark: false, lite: true }).vars;
    expect(lite["--mat-2-filter"]).toBe("blur(12px) saturate(1.8)");
    expect(lite["--mat-3-filter"]).toBe("blur(12px) saturate(1.8)");
    expect(lite["--mat-sh-1"]).toBe("0 1px 1px rgba(17, 19, 24, 0.05)");
    const none = computeGlassVars({ ...GLASS_DEFAULTS, blur: 0 }, { dark: false, lite: false }).vars;
    expect([none["--mat-2-filter"], none["--mat-2-bar-filter"], none["--mat-3-filter"]]).toEqual(["none", "none", "none"]);
  });

  it("saturation for the title bar is capped at 1.3 and radius is written as-is", () => {
    const v = computeGlassVars({ ...GLASS_DEFAULTS, blur: 1, saturate: 2, radius: 0.6 }, { dark: false, lite: false }).vars;
    expect(v["--mat-2-filter"]).toBe("blur(24px) saturate(2)");
    expect(v["--mat-2-bar-filter"]).toBe("blur(24px) saturate(1.3)");
    expect(v["--gx-radius"]).toBe("0.6");
  });
});

describe("default theme is 清透 (owner request 2026-10-15)", () => {
  const OVER = (fg: Rgb, a: number, bg: Rgb): Rgb => [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))) as Rgb;
  const INK = { light: [17, 19, 24] as Rgb, dark: [243, 244, 246] as Rgb };
  const INK_2 = { light: [91, 97, 112] as Rgb, dark: [166, 171, 184] as Rgb };
  const MAT_1 = { light: [255, 255, 255] as Rgb, dark: [255, 255, 255] as Rgb };
  const MAT_2 = { light: [255, 255, 255] as Rgb, dark: [28, 30, 36] as Rgb };
  const PLATE = { light: { rgb: [255, 255, 255] as Rgb, a: 0.9 }, dark: { rgb: [23, 25, 30] as Rgb, a: 0.9 } };
  const strict = { light: [0, 0, 0] as Rgb, dark: [255, 255, 255] as Rgb };

  it("a fresh theme is the 清透 preset values, radius 1, gradient, not reduced", () => {
    expect(GLASS_DEFAULTS).toMatchObject({ preset: "clear", ...GLASS_PRESETS.clear, radius: 1, bgStyle: "gradient", reduced: false });
    expect(parseGlassTheme(undefined)).toEqual(GLASS_DEFAULTS);
    expect(parseGlassTheme({ v: 1 })).toEqual(GLASS_DEFAULTS);
  });

  it("a stored theme keeps its own values and name; a stored theme without a name is 清透", () => {
    const stored = parseGlassTheme({ ...withPreset(GLASS_DEFAULTS, "frosted"), radius: 0.6 });
    expect(stored).toMatchObject({ preset: "frosted", ...GLASS_PRESETS.frosted, radius: 0.6 });
    const { preset: _drop, ...noName } = GLASS_DEFAULTS;
    expect(parseGlassTheme(noName).preset).toBe("clear");
  });

  it("the sliders' floors still hold at the default: the clearest the default can go is the floor", () => {
    const light = computeGlassVars(GLASS_DEFAULTS, { dark: false, lite: false });
    const dark = computeGlassVars(GLASS_DEFAULTS, { dark: true, lite: false });
    expect([light.vars["--mat-1-alpha"], light.vars["--mat-2-alpha"], light.vars["--mat-2-bar-alpha"], light.vars["--mat-3-alpha"]]).toEqual(["0.5", "0.55", "0.62", "0.62"]);
    expect([dark.vars["--mat-1-alpha"], dark.vars["--mat-2-alpha"], dark.vars["--mat-2-bar-alpha"], dark.vars["--mat-3-alpha"]]).toEqual(["0.04", "0.5", "0.58", "0.58"]);
    expect(light.floorHit).toBe(true);
    expect(light.vars["--mat-2-filter"]).toBe("blur(30px) saturate(1.8)");
    expect(light.vars["--mat-3-filter"]).toBe("blur(40px) saturate(1.8)");
    expect(light.vars["--mat-2-bar-filter"]).toBe("blur(30px) saturate(1.3)");
  });

  it("plates stay solid .90 and meet the picks.md worst case (strict black / white backdrop)", () => {
    for (const mode of ["light", "dark"] as const) {
      const plate = OVER(PLATE[mode].rgb, PLATE[mode].a, strict[mode]);
      expect(contrastRatio(INK[mode], plate), `${mode} ink`).toBeGreaterThanOrEqual(12);
      expect(contrastRatio(INK_2[mode], plate), `${mode} ink-2`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("text on section cards (T1) meets AA at the default over the worse gradient end", () => {
    for (const mode of ["light", "dark"] as const) {
      const dark = mode === "dark";
      const c = computeGlassVars(GLASS_DEFAULTS, { dark, lite: false });
      const a = n(c.vars["--mat-1-alpha"]);
      const backdrop = dark ? c.bg.top : c.bg.bottom;
      const card = OVER(MAT_1[mode], a, backdrop);
      expect(contrastRatio(INK[mode], card), `${mode} ink on card`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(INK_2[mode], card), `${mode} ink-2 on card`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("large titles on the bar / sheet glass keep >= 3:1 even over a strict backdrop (Rev 4)", () => {
    for (const mode of ["light", "dark"] as const) {
      const c = computeGlassVars(GLASS_DEFAULTS, { dark: mode === "dark", lite: false });
      const bar = OVER(MAT_2[mode], n(c.vars["--mat-2-bar-alpha"]), strict[mode]);
      expect(contrastRatio(INK[mode], bar), `${mode} title on bar`).toBeGreaterThanOrEqual(3);
    }
  });
});
