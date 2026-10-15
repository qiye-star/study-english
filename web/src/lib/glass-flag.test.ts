import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  GLASS_ATTR, initGlassFlag, isGlassOn, isLiquid, isPinnedPath, setGlassPinned, useLiquid,
} from "./glass-flag";

const fakeWin = (search: string): Window =>
  ({ location: { search }, localStorage: window.localStorage, document } as unknown as Window);
const root = () => document.documentElement;

describe("glass flag (plan 2026-10-15-liquid-glass L0, INDEX §4.1)", () => {
  afterEach(() => {
    root().removeAttribute(GLASS_ATTR);
    window.localStorage.removeItem("enjoy-web.dev.glass");
  });

  it("is on for everyone and forgets the old development switch (plan 2026-10-15-liquid-glass L12)", () => {
    window.localStorage.setItem("enjoy-web.dev.glass", "v2");
    expect(initGlassFlag(fakeWin("?glass=off"))).toBe(true);
    expect(root().getAttribute(GLASS_ATTR)).toBe("v2");
    expect(window.localStorage.getItem("enjoy-web.dev.glass")).toBeNull();
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
