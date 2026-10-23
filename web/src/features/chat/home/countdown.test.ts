import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Countdown, useCountdown } from "./countdown";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Countdown", () => {
  it("fires once after the full time", () => {
    const done = vi.fn();
    new Countdown(5000, done).start();
    vi.advanceTimersByTime(4999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(10000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("pauses and resumes with the remaining time", () => {
    const done = vi.fn();
    const c = new Countdown(5000, done);
    c.start();
    vi.advanceTimersByTime(2000);
    c.pause();
    vi.advanceTimersByTime(60000);
    expect(done).not.toHaveBeenCalled();
    expect(c.remaining()).toBe(3000);
    c.start();
    vi.advanceTimersByTime(2999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("never fires after cancel", () => {
    const done = vi.fn();
    const c = new Countdown(1000, done);
    c.start();
    c.cancel();
    vi.advanceTimersByTime(5000);
    expect(done).not.toHaveBeenCalled();
  });
});

describe("useCountdown", () => {
  const setup = (initial: { active: boolean; paused: boolean }, onDone = vi.fn()) =>
    ({ onDone, ...renderHook((p: { active: boolean; paused: boolean }) => useCountdown({ ms: 5000, onDone, ...p }), { initialProps: initial }) });

  it("starts when active flips on, pauses, and fires once", () => {
    const { result, rerender, onDone } = setup({ active: false, paused: false });
    act(() => vi.advanceTimersByTime(10000));
    expect(onDone).not.toHaveBeenCalled();
    rerender({ active: true, paused: false });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(4);
    rerender({ active: true, paused: true });
    act(() => vi.advanceTimersByTime(30000));
    expect(onDone).not.toHaveBeenCalled();
    rerender({ active: true, paused: false });
    act(() => vi.advanceTimersByTime(4000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("cleans up on unmount", () => {
    const { unmount, onDone } = setup({ active: true, paused: false });
    unmount();
    act(() => vi.advanceTimersByTime(10000));
    expect(onDone).not.toHaveBeenCalled();
  });
});
