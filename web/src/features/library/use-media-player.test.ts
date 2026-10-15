import { describe, expect, it, vi } from "vitest";
import {
  PAD_AFTER_MS, PAD_BEFORE_MS, PlayerController, leadOf, nextLoop, nextRate, pctFromRate, rateFromPct, segmentIndexAt, tailOf,
  type Frames,
} from "./use-media-player";

const SEGS = [
  { idx: 0, startMs: 1000, endMs: 3000 },
  { idx: 1, startMs: 3200, endMs: 6000 },
  { idx: 2, startMs: 9000, endMs: 11000 },
];

/** 假的媒体元素:currentTime 的写入记为一次 seek;advanceTo 模拟播放推进(不算 seek)。 */
class FakeMedia extends EventTarget {
  private t = 0;
  seeks: number[] = [];
  paused = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
  get currentTime() { return this.t; }
  set currentTime(v: number) { this.t = v; this.seeks.push(v); }
  advanceTo(ms: number) { this.t = ms / 1000; }
  play = vi.fn((): Promise<void> => {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  });
}

function manualFrames() {
  const queue = new Map<number, () => void>();
  let id = 0;
  const frames: Frames & { flush(): void; size(): number } = {
    request: (fn) => { id += 1; queue.set(id, fn); return id; },
    cancel: (n) => { queue.delete(n); },
    flush: () => { const fns = [...queue.values()]; queue.clear(); fns.forEach((f) => f()); },
    size: () => queue.size,
  };
  return frames;
}

function setup(init: { rate?: 0.5 | 0.75 | 1 | 1.25; index?: number } = {}) {
  const media = new FakeMedia();
  const frames = manualFrames();
  const c = new PlayerController(media, SEGS, frames, init);
  const at = (ms: number) => { media.advanceTo(ms); frames.flush(); };
  return { media, frames, c, at };
}

describe("pure helpers", () => {
  it("finds the sentence whose start is the last one at or before the time", () => {
    expect(segmentIndexAt(SEGS, 0)).toBe(-1);
    expect(segmentIndexAt(SEGS, 1000)).toBe(0);
    expect(segmentIndexAt(SEGS, 3100)).toBe(0);
    expect(segmentIndexAt(SEGS, 3200)).toBe(1);
    expect(segmentIndexAt(SEGS, 99_999)).toBe(2);
    expect(segmentIndexAt([], 5)).toBe(-1);
  });

  it("maps rate_pct to the nearest rate and cycles loops and rates", () => {
    expect(rateFromPct(100)).toBe(1);
    expect(rateFromPct(50)).toBe(0.5);
    expect(rateFromPct(80)).toBe(0.75);
    expect(rateFromPct(200)).toBe(1.25);
    expect(rateFromPct(null)).toBe(1);
    expect(pctFromRate(0.75)).toBe(75);
    expect(["infinite", 3, 5, "once", "off"]).toEqual([nextLoop("off"), nextLoop("infinite"), nextLoop(3), nextLoop(5), nextLoop("once")]);
    expect([nextRate(0.5), nextRate(0.75), nextRate(1), nextRate(1.25)]).toEqual([0.75, 1, 1.25, 0.5]);
  });
});

describe("PlayerController (spec §11.4, R-L13)", () => {
  it("applies the initial rate with pitch preserved and changes it later", () => {
    const { media, c } = setup({ rate: 0.75 });
    expect(media.playbackRate).toBe(0.75);
    expect(media.defaultPlaybackRate).toBe(0.75);
    expect(media.preservesPitch).toBe(true);
    expect(media.webkitPreservesPitch).toBe(true);
    c.setRate(1.25);
    expect(media.playbackRate).toBe(1.25);
    expect(c.getState().rate).toBe(1.25);
  });

  it("seeks 150 ms before a sentence (never below 0) and plays", () => {
    const { media, c } = setup();
    c.seekTo(1);
    expect(media.seeks).toEqual([3.05]);
    expect(media.play).toHaveBeenCalled();
    expect(c.getState()).toMatchObject({ index: 1, playing: true });
    c.seekTo(0, false);
    expect(media.seeks.at(-1)).toBeCloseTo(0.85);
    c.seekTo(99);
    expect(media.seeks).toHaveLength(2);
  });

  it("with loop off follows the time naturally", () => {
    const { c, at } = setup();
    c.seekTo(0);
    at(2000);
    expect(c.getState().index).toBe(0);
    at(3300);
    expect(c.getState().index).toBe(1);
    at(9500);
    expect(c.getState().index).toBe(2);
  });

  it("loops one sentence forever, at the next sentence's start when the gap is shorter than 250 ms (plan v2 R-V11)", () => {
    const { media, c, at } = setup();
    c.setLoop("infinite");
    c.seekTo(0);
    at(3199);
    expect(media.seeks).toHaveLength(1);
    for (let i = 1; i <= 3; i += 1) {
      at(3200);
      expect(media.seeks).toHaveLength(1 + i);
      expect(media.seeks.at(-1)).toBeCloseTo(0.85);
      expect(c.getState()).toMatchObject({ index: 0, repeats: i });
    }
  });

  it("plays each sentence 3 times, then moves on and repeats the next one too", () => {
    const { media, c, at } = setup();
    c.setLoop(3);
    c.seekTo(0);
    at(3250);
    at(3250);
    expect(media.seeks).toHaveLength(3);
    at(3300);
    expect(c.getState()).toMatchObject({ index: 1, repeats: 0 });
    expect(media.seeks).toHaveLength(3);
    at(6250);
    expect(media.seeks.at(-1)).toBeCloseTo(3.05);
    expect(c.getState()).toMatchObject({ index: 1, repeats: 1 });
  });

  it("does not jump back again inside the gap after a loop has finished", () => {
    const { media, c, at } = setup();
    c.setLoop(3);
    c.seekTo(1);
    at(6250);
    at(6250);
    at(6250);
    const seeks = media.seeks.length;
    at(7000);
    at(8000);
    expect(media.seeks).toHaveLength(seeks);
    expect(c.getState().index).toBe(1);
    at(9100);
    expect(c.getState().index).toBe(2);
  });

  it("plays one sentence once and pauses after it (W2's 'original')", () => {
    const { media, c, at } = setup();
    c.playOnce(1);
    expect(c.getState().once).toBe(true);
    at(6249);
    expect(media.pause).not.toHaveBeenCalled();
    at(6250);
    expect(media.pause).toHaveBeenCalled();
    expect(c.getState()).toMatchObject({ once: false, playing: false });
  });

  it("once mode: a sentence plays to its end (+ tail), pauses, and a resume goes on into the next one", () => {
    const { media, c, at } = setup();
    c.setLoop("once");
    c.seekTo(0);
    at(3000);
    expect(media.pause).not.toHaveBeenCalled();
    at(3200);
    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(c.getState()).toMatchObject({ index: 0, playing: false, loop: "once" });
    c.play();
    at(3200);
    expect(c.getState().index).toBe(1);
    expect(media.pause).toHaveBeenCalledTimes(1);
    at(6249);
    expect(media.pause).toHaveBeenCalledTimes(1);
    at(6250);
    expect(media.pause).toHaveBeenCalledTimes(2);
    expect(c.getState()).toMatchObject({ index: 1, playing: false });
    c.play();
    at(6250);
    at(8000);
    expect(media.pause).toHaveBeenCalledTimes(2);
    expect(c.getState().index).toBe(1);
    at(9100);
    expect(c.getState().index).toBe(2);
    at(11250);
    expect(media.pause).toHaveBeenCalledTimes(3);
  });

  it("once mode: seekTo(idx) and prev() play only that sentence, then pause", () => {
    const { media, c, at } = setup();
    c.setLoop("once");
    c.seekTo(1);
    at(6250);
    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(c.getState().index).toBe(1);
    c.prev();
    expect(c.getState()).toMatchObject({ index: 0, playing: true });
    at(3200);
    expect(media.pause).toHaveBeenCalledTimes(2);
    expect(c.getState().index).toBe(0);
  });

  it("switching away from once mode resumes the normal flow", () => {
    const { media, c, at } = setup();
    c.setLoop("once");
    c.seekTo(0);
    at(3200);
    expect(c.getState().playing).toBe(false);
    c.setLoop("off");
    c.play();
    at(3300);
    at(6250);
    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(c.getState().index).toBe(1);
  });

  it("schedules frames only while playing", () => {
    const { frames, c } = setup();
    expect(frames.size()).toBe(0);
    c.seekTo(0);
    expect(frames.size()).toBe(1);
    c.pause();
    expect(frames.size()).toBe(0);
  });

  it("stays paused when the browser refuses to play", async () => {
    const { media, c } = setup();
    media.play.mockImplementationOnce(() => Promise.reject(new Error("NotAllowedError")));
    c.seekTo(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(c.getState().playing).toBe(false);
  });

  it("restores a saved position and guards prev / next at the ends", () => {
    const { media, c } = setup();
    c.restore(4000, 1);
    expect(media.currentTime).toBe(4);
    expect(c.getState().index).toBe(1);
    c.restore(9500, 99);
    expect(c.getState().index).toBe(2);
    c.next();
    expect(c.getState().index).toBe(2);
    c.seekTo(0, false);
    c.prev();
    expect(c.getState().index).toBe(0);
    expect(c.currentMs()).toBe(850);
  });

  it("notifies subscribers and stops listening after destroy", () => {
    const { media, c } = setup();
    const fn = vi.fn();
    const off = c.subscribe(fn);
    c.setLoop(5);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    c.destroy();
    media.dispatchEvent(new Event("play"));
    expect(c.getState().playing).toBe(false);
  });
});

describe("gap-aware pads (plan v2 R-V11)", () => {
  const segs = [
    { idx: 0, startMs: 1000, endMs: 2000 },
    { idx: 1, startMs: 2080, endMs: 3000 }, // 80 ms after the previous one
    { idx: 2, startMs: 3000, endMs: 4000 }, // touches the previous one (subtitles)
    { idx: 3, startMs: 9000, endMs: 9500 },
  ];

  it("never pre-rolls into the previous sentence or post-rolls into the next one when there is a gap", () => {
    expect(leadOf(segs, 0)).toBe(PAD_BEFORE_MS);
    expect(leadOf(segs, 1)).toBe(80);
    expect(tailOf(segs, 0)).toBe(80);
    expect(tailOf(segs, 3)).toBe(PAD_AFTER_MS);
    expect(leadOf(segs, 3)).toBe(PAD_BEFORE_MS); // a 5 s gap is longer than the pad
  });

  it("keeps the full pads for sentences that touch, as before", () => {
    expect(tailOf(segs, 1)).toBe(PAD_AFTER_MS);
    expect(leadOf(segs, 2)).toBe(PAD_BEFORE_MS);
  });
});
