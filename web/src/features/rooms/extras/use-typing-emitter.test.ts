import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTypingEmitter } from "./use-typing-emitter";

describe("useTypingEmitter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("throttles typing and falls back to idle", () => {
    const send = vi.fn((_s: string) => true);
    const { result, unmount } = renderHook(() => useTypingEmitter(send));
    act(() => { result.current.onDraft("H"); result.current.onDraft("He"); });
    expect(send.mock.calls).toEqual([["typing"]]);
    act(() => { vi.advanceTimersByTime(3_100); result.current.onDraft("Hel"); });
    expect(send.mock.calls).toEqual([["typing"], ["typing"]]);
    act(() => { vi.advanceTimersByTime(5_100); });
    expect(send).toHaveBeenLastCalledWith("idle");
    act(() => { result.current.onDraft("x"); result.current.onSent(); });
    expect(send).toHaveBeenLastCalledWith("idle");
    send.mockClear();
    unmount();
    expect(send).not.toHaveBeenCalled(); // already idle
  });

  it("sends idle when the draft is cleared or on unmount while typing, never twice", () => {
    const send = vi.fn((_s: string) => true);
    const { result, unmount } = renderHook(() => useTypingEmitter(send));
    act(() => { result.current.onDraft("Hi"); result.current.onDraft(""); result.current.onDraft("  "); });
    expect(send.mock.calls).toEqual([["typing"], ["idle"]]);
    // typing again right after clearing is a new state, not throttled
    act(() => { result.current.onDraft("Hi again"); });
    expect(send.mock.calls).toEqual([["typing"], ["idle"], ["typing"]]);
    unmount();
    expect(send).toHaveBeenLastCalledWith("idle");
    expect(send).toHaveBeenCalledTimes(4);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("does not count a frame that could not be sent", () => {
    const send = vi.fn((_s: string) => false);
    const { result } = renderHook(() => useTypingEmitter(send));
    act(() => { result.current.onDraft("H"); });
    act(() => { result.current.onDraft("He"); });
    expect(send.mock.calls).toEqual([["typing"], ["typing"]]); // offline: retried on the next keystroke
    act(() => { result.current.onSent(); });
    expect(send).toHaveBeenCalledTimes(2); // never reached typing, so no idle either
  });
});
