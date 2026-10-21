import { describe, expect, it, vi } from "vitest";
import { createTakeScheduler, type TakeFrames, type TakeMedia } from "./take-scheduler";
import type { LineWindow } from "./windows";

/** 假媒体:时间由测试直接写;play / pause 发 play、pause 事件(与 HTMLMediaElement 同名)。 */
function fakeMedia(): TakeMedia & { emit(type: string): void; listenerCount(type: string): number } {
  const listeners = new Map<string, Set<() => void>>();
  const media = {
    currentTime: 0,
    paused: true,
    muted: false,
    playbackRate: 1,
    play: vi.fn(() => {
      media.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      media.paused = true;
      media.emit("pause");
    }),
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    emit(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
  return media;
}

/** 假帧:每次 tick() 只跑最近一次请求的回调;记录取消。 */
function fakeFrames() {
  let next: (() => void) | null = null;
  let id = 0;
  const cancelled: number[] = [];
  const frames: TakeFrames = {
    request(fn) {
      next = fn;
      id += 1;
      return id;
    },
    cancel(x) {
      cancelled.push(x);
      next = null;
    },
  };
  return {
    frames,
    cancelled,
    pending: () => next !== null,
    tick() {
      const fn = next;
      next = null;
      fn?.();
    },
  };
}

const WINDOWS: LineWindow[] = [
  { idx: 2, startMs: 4700, endMs: 6600, lineStartMs: 5000, lineEndMs: 6000 },
  { idx: 5, startMs: 12000, endMs: 14000, lineStartMs: 12300, lineEndMs: 13400 },
];

function setup(over: Partial<Parameters<typeof createTakeScheduler>[0]> = {}) {
  const media = fakeMedia();
  const f = fakeFrames();
  const cb = { onOpen: vi.fn(), onClose: vi.fn(), onEnd: vi.fn(), onInterrupted: vi.fn() };
  const sched = createTakeScheduler({
    media, frames: f.frames, windows: WINDOWS, clipStartMs: 4000, clipEndMs: 14000, leadMs: 1500, tailMs: 600, ...cb, ...over,
  });
  return { media, f, cb, sched };
}

describe("take scheduler (plan L5 W4)", () => {
  it("start seeks to clip start minus the lead-in, plays at 1.0x and mutes nothing yet", () => {
    const { media, sched } = setup();
    sched.start();
    expect(media.currentTime).toBeCloseTo(2.5, 5);
    expect(media.playbackRate).toBe(1);
    expect(media.play).toHaveBeenCalled();
  });

  it("mutes exactly inside the windows, frame by frame", () => {
    const { media, f, sched } = setup();
    sched.start();
    media.currentTime = 5; f.tick();
    expect(media.muted).toBe(true);
    media.currentTime = 7; f.tick();
    expect(media.muted).toBe(false);
  });

  it("opens and closes each window once, passing the index and the media time", () => {
    const { media, f, cb, sched } = setup();
    sched.start();
    media.currentTime = 4.8; f.tick();
    expect(cb.onOpen).toHaveBeenCalledWith(2, 4800);
    media.currentTime = 6.7; f.tick();
    expect(cb.onClose).toHaveBeenCalledWith(2, 6700);
    expect(cb.onOpen).toHaveBeenCalledTimes(1);
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it("a media-time rewind (ticket refresh) does not reopen a closed window", () => {
    const { media, f, cb, sched } = setup();
    sched.start();
    media.currentTime = 5; f.tick();
    media.currentTime = 7; f.tick();
    media.currentTime = 4.8; f.tick();
    media.currentTime = 5; f.tick();
    expect(cb.onOpen).toHaveBeenCalledTimes(1);
  });

  it("ends at clip end plus the tail: pauses, unmutes, stops frames and calls onEnd", () => {
    const { media, f, cb, sched } = setup();
    sched.start();
    media.currentTime = 14.6; f.tick();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(media.paused).toBe(true);
    expect(media.muted).toBe(false);
    expect(f.pending()).toBe(false);
  });

  it("a pause that the system causes mid-take is an interruption, reported once", () => {
    const { media, f, cb, sched } = setup();
    sched.start();
    media.emit("pause");
    media.emit("pause");
    expect(cb.onInterrupted).toHaveBeenCalledTimes(1);
    expect(cb.onEnd).not.toHaveBeenCalled();
    expect(f.pending()).toBe(false);
  });

  it("a play() that is refused is also an interruption", async () => {
    const { media, cb, sched } = setup();
    media.play = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    sched.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(cb.onInterrupted).toHaveBeenCalledTimes(1);
  });

  it("destroy unmutes, stops frames and stops listening: a later pause is not reported", () => {
    const { media, f, cb, sched } = setup();
    sched.start();
    media.currentTime = 5; f.tick();
    expect(media.muted).toBe(true);
    sched.destroy();
    expect(media.muted).toBe(false);
    expect(f.pending()).toBe(false);
    expect(media.listenerCount("pause")).toBe(0);
    media.emit("pause");
    expect(cb.onInterrupted).not.toHaveBeenCalled();
  });
});
