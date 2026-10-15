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
