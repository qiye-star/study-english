import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickSpark, countUpValue, motionAllowed, useCountUp } from "./shadow-fx";

describe("motionAllowed", () => {
  afterEach(() => document.documentElement.classList.remove("lite"));

  it("is true by default, false on low-end devices (html.lite) and with prefers-reduced-motion", () => {
    expect(motionAllowed()).toBe(true);
    document.documentElement.classList.add("lite");
    expect(motionAllowed()).toBe(false);
    document.documentElement.classList.remove("lite");
    const win = { document, matchMedia: () => ({ matches: true }) } as unknown as Window;
    expect(motionAllowed(win)).toBe(false);
  });
});

describe("countUpValue / useCountUp", () => {
  it("eases out from 0 to the target", () => {
    expect(countUpValue(0, 80)).toBe(0);
    expect(countUpValue(1, 80)).toBe(80);
    expect(countUpValue(0.5, 80)).toBeGreaterThan(40);
  });

  it("gives the final value at once when animation is off", () => {
    const { result } = renderHook(() => useCountUp(88, { enabled: false }));
    expect(result.current).toBe(88);
  });

  it("rolls from 0 to the target with the animation frames", () => {
    const callbacks: Array<(now: number) => void> = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { callbacks.push(cb); return callbacks.length; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const { result } = renderHook(() => useCountUp(80, { enabled: true, durationMs: 1000 }));
    expect(result.current).toBe(0);
    act(() => callbacks.shift()!(0));
    act(() => callbacks.shift()!(500));
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(80);
    act(() => callbacks.shift()!(1000));
    expect(result.current).toBe(80);
  });
});

describe("ClickSpark", () => {
  it("bursts eight sparks on click and clears them afterwards", () => {
    vi.useFakeTimers();
    try {
      render(<ClickSpark><button type="button" data-testid="b">x</button></ClickSpark>);
      fireEvent.click(screen.getByTestId("b"));
      expect(document.querySelectorAll(".shs-spark")).toHaveLength(8);
      act(() => { vi.advanceTimersByTime(700); });
      expect(document.querySelectorAll(".shs-spark")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when disabled or when motion is off", () => {
    render(<ClickSpark disabled><button type="button" data-testid="d">x</button></ClickSpark>);
    fireEvent.click(screen.getByTestId("d"));
    expect(document.querySelectorAll(".shs-spark")).toHaveLength(0);
    document.documentElement.classList.add("lite");
    try {
      render(<ClickSpark><button type="button" data-testid="e">x</button></ClickSpark>);
      fireEvent.click(screen.getByTestId("e"));
      expect(document.querySelectorAll(".shs-spark")).toHaveLength(0);
    } finally {
      document.documentElement.classList.remove("lite");
    }
  });

  it("clears its timer on unmount without warnings", () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const view = render(<ClickSpark><button type="button" data-testid="u">x</button></ClickSpark>);
      fireEvent.click(screen.getByTestId("u"));
      view.unmount();
      act(() => { vi.advanceTimersByTime(700); });
      expect(err).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
