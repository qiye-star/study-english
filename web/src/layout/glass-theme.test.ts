import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLASS_ATTR } from "~/lib/glass-flag";
import { GLASS_DEFAULTS } from "~/lib/glass-theme";
import { GLASS_THEME_KEY } from "~/lib/storage";
import { resetGlassThemeMemory, setGlassTheme } from "~/settings/glass-theme-store";
import { setThemeColorOverride } from "./color-scheme";
import { applyGlassTheme, initGlassTheme } from "./glass-theme";

const root = document.documentElement;
const v = (name: string) => root.style.getPropertyValue(name);
const fakeWin = (deviceMemory?: number): Window =>
  Object.assign(Object.create(window), { navigator: { deviceMemory }, document, requestAnimationFrame: (cb: FrameRequestCallback) => { cb(0); return 1; }, cancelAnimationFrame: () => {} });
const metas = () => [...document.querySelectorAll("meta[name='theme-color']")];

describe("glass theme writer (plan 2026-10-15-liquid-glass L1)", () => {
  beforeEach(() => {
    window.localStorage.removeItem(GLASS_THEME_KEY);
    resetGlassThemeMemory();
    document.head.innerHTML =
      '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">' +
      '<meta name="theme-color" content="#0F1013" media="(prefers-color-scheme: dark)">';
  });
  afterEach(() => {
    setThemeColorOverride(null);
    document.head.innerHTML = "";
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
    expect(metas().map((m) => m.getAttribute("content"))).toEqual(["#ffffff", "#0F1013"]);
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

  describe("theme-color follows the chosen background (owner Q2)", () => {
    it("sets both metas to the page-top colour and drops media while the skin is on", () => {
      root.setAttribute(GLASS_ATTR, "v2");
      applyGlassTheme(GLASS_DEFAULTS, fakeWin(8));
      expect(metas().map((m) => m.getAttribute("content"))).toEqual(["#f6f7f8", "#f6f7f8"]);
      expect(metas().every((m) => !m.hasAttribute("media"))).toBe(true);
    });

    it("uses the flat colour for the solid style and the dark slot in dark mode", () => {
      root.setAttribute(GLASS_ATTR, "v2");
      applyGlassTheme({ ...GLASS_DEFAULTS, bgStyle: "solid" }, fakeWin(8));
      expect(metas()[0].getAttribute("content")).toBe("#f0f2f4");
      root.classList.add("dark");
      applyGlassTheme(GLASS_DEFAULTS, fakeWin(8));
      expect(metas()[0].getAttribute("content")).toBe("#14161a");
    });

    it("restores the original metas on a pinned route (data-glass=pin) and after cleanup", async () => {
      root.setAttribute(GLASS_ATTR, "v2");
      const stop = initGlassTheme(fakeWin(8));
      expect(metas()[0].getAttribute("content")).toBe("#f6f7f8");
      root.setAttribute(GLASS_ATTR, "pin");
      await vi.waitFor(() => expect(metas().map((m) => m.getAttribute("content"))).toEqual(["#ffffff", "#0F1013"]));
      expect(metas()[0].getAttribute("media")).toBe("(prefers-color-scheme: light)");
      root.setAttribute(GLASS_ATTR, "v2");
      await vi.waitFor(() => expect(metas()[0].getAttribute("content")).toBe("#f6f7f8"));
      stop();
      expect(metas().map((m) => m.getAttribute("content"))).toEqual(["#ffffff", "#0F1013"]);
    });

    it("a clamped custom background colours the status bar with the clamped value", () => {
      root.setAttribute(GLASS_ATTR, "v2");
      const t = { ...GLASS_DEFAULTS, bg: { ...GLASS_DEFAULTS.bg, light: { swatch: null, h: 0, s: 0, l: 20, second: null } } };
      applyGlassTheme(t, fakeWin(8));
      // lightness 20 is clamped up by the guard; the meta must never show the unclamped dark colour
      expect(metas()[0].getAttribute("content")).not.toBe("#333333");
    });
  });
});
