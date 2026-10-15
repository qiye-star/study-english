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
