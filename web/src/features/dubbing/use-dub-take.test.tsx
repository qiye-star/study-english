import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LineWindow } from "./windows";
import { useDubTake, type UseDubTakeInput } from "./use-dub-take";

const h = vi.hoisted(() => {
  const runner = {
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    state: vi.fn(() => "idle"),
    outcomes: vi.fn(() => []),
    result: vi.fn(() => null),
    subscribe: vi.fn((fn: (s: string) => void) => {
      h.listener = fn;
      return () => {};
    }),
  };
  const h = { runner, listener: null as ((s: string) => void) | null, createTakeRunner: vi.fn(() => runner) };
  return h;
});

vi.mock("~/auth/auth-context", () => ({ useAuth: () => ({ api: {} }) }));
vi.mock("./take-runner", async (orig) => ({ ...(await orig<typeof import("./take-runner")>()), createTakeRunner: h.createTakeRunner }));

const WINDOWS: LineWindow[] = [{ idx: 0, startMs: 0, endMs: 1000, lineStartMs: 300, lineEndMs: 900 }];
const input = (over: Partial<UseDubTakeInput> = {}): UseDubTakeInput => ({
  itemId: "11111111-1111-4111-8111-111111111111",
  segFrom: 0,
  segTo: 0,
  role: "A",
  media: { currentTime: 0, paused: true, muted: false, playbackRate: 1, play: vi.fn(), pause: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
  windows: WINDOWS,
  clipStartMs: 0,
  clipEndMs: 1000,
  textOf: () => "Hello there.",
  ...over,
});

describe("useDubTake (plan L5 W6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listener = null;
  });

  it("start does nothing without a video element", () => {
    const { result } = renderHook(() => useDubTake(input({ media: null })));
    act(() => result.current.start());
    expect(h.createTakeRunner).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  it("start creates one runner and starts it; the state follows the runner", () => {
    const { result } = renderHook(() => useDubTake(input()));
    act(() => result.current.start());
    expect(h.createTakeRunner).toHaveBeenCalledTimes(1);
    expect(h.runner.start).toHaveBeenCalledTimes(1);
    act(() => h.listener?.("recording"));
    expect(result.current.state).toBe("recording");
  });

  it("stop hands the stop to the runner", () => {
    const { result } = renderHook(() => useDubTake(input()));
    act(() => result.current.start());
    act(() => result.current.stop());
    expect(h.runner.stop).toHaveBeenCalledTimes(1);
  });

  it("unmounting disposes the runner (microphone, playback, object URLs)", () => {
    const { result, unmount } = renderHook(() => useDubTake(input()));
    act(() => result.current.start());
    unmount();
    expect(h.runner.dispose).toHaveBeenCalled();
  });
});
