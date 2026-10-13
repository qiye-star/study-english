import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KEYBOARD_SETTLE_MS, useAppHeight } from "./use-app-height";

type Fn = () => void;

class Bus {
  private map = new Map<string, Set<Fn>>();
  addEventListener = (type: string, fn: Fn) => {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)!.add(fn);
  };
  removeEventListener = (type: string, fn: Fn) => { this.map.get(type)?.delete(fn); };
  emit(type: string) { [...(this.map.get(type) ?? [])].forEach((fn) => fn()); }
  get size() { return [...this.map.values()].reduce((n, set) => n + set.size, 0); }
}

interface VV { height: number; offsetTop: number; scale: number }

/** 手写的窗口:visualViewport / window / document 三条事件总线,rAF 与计时器各一个队列,scrollTo 是 mock。 */
function makeEnv(vv: Partial<VV> | null = {}) {
  const vvBus = new Bus();
  const winBus = new Bus();
  const docBus = new Bus();
  const visualViewport = vv === null ? null : Object.assign(vvBus, { height: 600, offsetTop: 0, scale: 1 }, vv);

  const frames = new Map<number, Fn>();
  let nextFrame = 1;
  const timers = new Map<number, Fn>();
  let nextTimer = 1;

  const win = {
    visualViewport,
    innerHeight: 700,
    scrollY: 0,
    document: Object.assign(docBus, { documentElement: document.documentElement }),
    addEventListener: winBus.addEventListener,
    removeEventListener: winBus.removeEventListener,
    scrollTo: vi.fn(),
    requestAnimationFrame: vi.fn((cb: Fn) => { const id = nextFrame++; frames.set(id, cb); return id; }),
    cancelAnimationFrame: vi.fn((id: number) => { frames.delete(id); }),
    setTimeout: vi.fn((cb: Fn) => { const id = nextTimer++; timers.set(id, cb); return id; }),
    clearTimeout: vi.fn((id: number) => { timers.delete(id); }),
  };
  return {
    win,
    window: win as unknown as Window,
    vv: visualViewport as (Bus & VV) | null,
    vvBus, winBus, docBus,
    flushFrames() { const run = [...frames.values()]; frames.clear(); run.forEach((fn) => fn()); },
    fireTimers() { const run = [...timers.values()]; timers.clear(); run.forEach((fn) => fn()); },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
  };
}

afterEach(() => document.documentElement.style.removeProperty("--app-height"));

describe("useAppHeight: --app-height", () => {
  it("writes the visual viewport height (innerHeight without one) and follows both resize sources", () => {
    const env = makeEnv({ height: 600 });
    renderHook(() => useAppHeight(env.window));
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("600px");
    env.vv!.height = 420;
    env.vvBus.emit("resize");
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("420px");
    env.vv!.height = 380;
    env.winBus.emit("resize");
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("380px");

    const plain = makeEnv(null);
    renderHook(() => useAppHeight(plain.window));
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("700px");
  });
});

describe("useAppHeight: keeping the layout viewport at the origin", () => {
  it("does not call scrollTo when nothing is offset, whatever the event", () => {
    const env = makeEnv({ offsetTop: 0 });
    renderHook(() => useAppHeight(env.window));
    for (const [bus, type] of [[env.vvBus, "resize"], [env.vvBus, "scroll"], [env.winBus, "resize"], [env.docBus, "focusin"], [env.docBus, "focusout"]] as const) {
      bus.emit(type);
      env.flushFrames();
    }
    env.fireTimers();
    env.flushFrames();
    expect(env.win.scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls back to (0,0) in the next frame when visualViewport.offsetTop > 0 (not synchronously)", () => {
    const env = makeEnv({ offsetTop: 0 });
    renderHook(() => useAppHeight(env.window));
    env.vv!.offsetTop = 38;
    env.vvBus.emit("scroll");
    expect(env.win.scrollTo).not.toHaveBeenCalled();
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledTimes(1);
    expect(env.win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("also corrects window.scrollY !== 0 and reacts to focusin", () => {
    const env = makeEnv({ offsetTop: 0 });
    renderHook(() => useAppHeight(env.window));
    env.win.scrollY = 120;
    env.docBus.emit("focusin");
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("works without visualViewport (scrollY only)", () => {
    const env = makeEnv(null);
    renderHook(() => useAppHeight(env.window));
    env.docBus.emit("focusin");
    env.flushFrames();
    expect(env.win.scrollTo).not.toHaveBeenCalled();
    env.win.scrollY = 5;
    env.winBus.emit("resize");
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("coalesces a burst of events into one frame and one scrollTo", () => {
    const env = makeEnv({ offsetTop: 40 });
    renderHook(() => useAppHeight(env.window));
    for (let i = 0; i < 6; i++) { env.vvBus.emit("scroll"); env.vvBus.emit("resize"); env.docBus.emit("focusin"); }
    expect(env.win.requestAnimationFrame).toHaveBeenCalledTimes(1);
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("does not force layout in the handlers: scrollY / offsetTop are read only inside the frame", () => {
    const env = makeEnv({ offsetTop: 0 });
    const reads = vi.fn(() => 0);
    Object.defineProperty(env.win, "scrollY", { get: reads, configurable: true });
    renderHook(() => useAppHeight(env.window));
    reads.mockClear();
    env.vvBus.emit("scroll");
    env.docBus.emit("focusin");
    expect(reads).not.toHaveBeenCalled();
    env.flushFrames();
    expect(reads).toHaveBeenCalled();
  });

  it("settles once the correction took effect: a later scroll event does not call scrollTo again", () => {
    const env = makeEnv({ offsetTop: 30 });
    env.win.scrollTo.mockImplementation(() => { env.vv!.offsetTop = 0; });
    renderHook(() => useAppHeight(env.window));
    env.vvBus.emit("scroll");
    env.flushFrames();
    env.vvBus.emit("scroll"); // scrollTo 自己引起的那一次 scroll 事件
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("leaves a pinch-zoomed page alone (R-K2)", () => {
    const env = makeEnv({ offsetTop: 50, scale: 1.8 });
    renderHook(() => useAppHeight(env.window));
    env.vvBus.emit("scroll");
    env.flushFrames();
    expect(env.win.scrollTo).not.toHaveBeenCalled();
  });

  it("resets once more after the keyboard has finished closing (focusout + delay)", () => {
    const env = makeEnv({ offsetTop: 0 });
    renderHook(() => useAppHeight(env.window));
    env.docBus.emit("focusout");
    env.flushFrames();
    expect(env.win.scrollTo).not.toHaveBeenCalled();
    expect(env.win.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), KEYBOARD_SETTLE_MS);
    env.vv!.offsetTop = 22; // 键盘动画结束时仍有残余偏移
    env.fireTimers();
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledTimes(1);
    expect(env.win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("a new focusin cancels the pending post-blur reset", () => {
    const env = makeEnv({ offsetTop: 0 });
    renderHook(() => useAppHeight(env.window));
    env.docBus.emit("focusout");
    expect(env.pendingTimers()).toBe(1);
    env.docBus.emit("focusin");
    expect(env.pendingTimers()).toBe(0);
  });

  it("removes every listener and cancels pending frame and timer on unmount", () => {
    const env = makeEnv({ offsetTop: 40 });
    const { unmount } = renderHook(() => useAppHeight(env.window));
    expect(env.vvBus.size).toBeGreaterThan(0);
    env.vvBus.emit("scroll");
    env.docBus.emit("focusout");
    expect(env.pendingFrames()).toBe(1);
    expect(env.pendingTimers()).toBe(1);
    unmount();
    expect(env.vvBus.size).toBe(0);
    expect(env.winBus.size).toBe(0);
    expect(env.docBus.size).toBe(0);
    expect(env.pendingFrames()).toBe(0);
    expect(env.pendingTimers()).toBe(0);
    env.flushFrames();
    env.fireTimers();
    expect(env.win.scrollTo).not.toHaveBeenCalled();
  });
});
