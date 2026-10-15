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
