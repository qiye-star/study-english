import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAYBACK_RATE_KEY, applyPlaybackRate, formatPlaybackRate, getPlaybackRate, nextPlaybackRate, resetPlaybackRate,
  resetPlaybackRateForTests, setPlaybackRate, trackMediaElement, usePlaybackRate,
} from "./playback-rate";

type Pitchy = HTMLMediaElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
const media = () => ({ playbackRate: 1, defaultPlaybackRate: 1 }) as unknown as Pitchy;

describe("playback rate", () => {
  beforeEach(() => {
    localStorage.clear();
    resetPlaybackRateForTests();
  });

  it("defaults to 1x and ignores unknown stored values", () => {
    expect(getPlaybackRate()).toBe(1);
    localStorage.setItem(PLAYBACK_RATE_KEY, "2");
    resetPlaybackRateForTests();
    expect(getPlaybackRate()).toBe(1);
  });

  it("persists the choice", () => {
    setPlaybackRate(0.75);
    expect(localStorage.getItem(PLAYBACK_RATE_KEY)).toBe("0.75");
    resetPlaybackRateForTests();
    expect(getPlaybackRate()).toBe(0.75);
  });

  it("applies rate, default rate and pitch preservation", () => {
    const el = media();
    applyPlaybackRate(el, 1.25);
    expect([el.playbackRate, el.defaultPlaybackRate, el.preservesPitch, el.webkitPreservesPitch]).toEqual([1.25, 1.25, true, true]);
  });

  it("updates tracked elements immediately, with reference counting", () => {
    const el = media();
    setPlaybackRate(0.75);
    const untrackA = trackMediaElement(el);
    const untrackB = trackMediaElement(el);
    expect(el.playbackRate).toBe(0.75);
    setPlaybackRate(1.25);
    expect(el.playbackRate).toBe(1.25);
    untrackA();
    untrackA(); // idempotent
    setPlaybackRate(1);
    expect(el.playbackRate).toBe(1);
    untrackB();
    setPlaybackRate(0.75);
    expect(el.playbackRate).toBe(1);
  });

  it("logout reset clears the key and broadcasts 1x", () => {
    setPlaybackRate(1.25);
    const { result } = renderHook(() => usePlaybackRate());
    expect(result.current).toBe(1.25);
    act(() => resetPlaybackRate());
    expect(result.current).toBe(1);
    expect(localStorage.getItem(PLAYBACK_RATE_KEY)).toBeNull();
  });

  it("cycles and formats", () => {
    expect([nextPlaybackRate(0.75), nextPlaybackRate(1), nextPlaybackRate(1.25)]).toEqual([1, 1.25, 0.75]);
    expect(formatPlaybackRate(1.25)).toBe("1.25×");
  });

  it("never throws when storage or the element refuses", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => setPlaybackRate(1.25)).not.toThrow();
    expect(getPlaybackRate()).toBe(1.25); // 本页仍生效
    vi.restoreAllMocks();
    const el = { set playbackRate(_: number) { throw new Error("NotSupportedError"); } } as unknown as HTMLMediaElement;
    expect(() => applyPlaybackRate(el, 0.75)).not.toThrow();
  });
});
