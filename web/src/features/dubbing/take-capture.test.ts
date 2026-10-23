import { describe, expect, it, vi } from "vitest";
import { type CaptureDeps, type PcmLike, type RecordingLike, startTakeCapture } from "./take-capture";

const RATE = 16000;
const FRAME = 320; // 20 ms @ 16 kHz

/** 一帧「有声」:0.5 振幅的正弦(约 -9 dBFS,远高于 -38 dBFS 门限)。 */
const loud = (n = FRAME) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i / 3));
const silent = (n = FRAME) => new Float32Array(n);

function fakePcm() {
  const frameCbs = new Set<(f: Float32Array, db: number) => void>();
  const endCbs = new Set<() => void>();
  const pcm: PcmLike = {
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    onTrackEnded(cb) {
      endCbs.add(cb);
      return () => endCbs.delete(cb);
    },
    release: vi.fn(),
  };
  return {
    pcm,
    push(frame: Float32Array) {
      for (const cb of frameCbs) cb(frame, 0);
    },
    end() {
      for (const cb of endCbs) cb();
    },
  };
}

function deps(over: Partial<CaptureDeps> = {}) {
  const p = fakePcm();
  const d: CaptureDeps = {
    decide: () => ({ mode: "pcm", context: {} as AudioContext }),
    startPcm: vi.fn(async () => p.pcm),
    startRecorder: vi.fn(async (): Promise<RecordingLike> => {
      throw new Error("not used");
    }),
    toSamples: vi.fn(async () => null),
    subscribeHidden: () => () => {},
    ...over,
  };
  return { d, p };
}

describe("take capture: PCM path (one microphone for the whole take)", () => {
  it("starts the microphone synchronously inside start(), before any await", () => {
    const { d } = deps();
    startTakeCapture(d, 0, () => {});
    expect(d.startPcm).toHaveBeenCalledTimes(1);
  });

  it("keeps only the frames inside an open window, unchanged (silence at the edges is not trimmed)", async () => {
    const { d, p } = deps();
    const take = startTakeCapture(d, 0, () => {});
    await take.ready;
    p.push(loud()); p.push(loud()); // outside any window: dropped
    take.open(2, 4700);
    p.push(silent()); p.push(silent());
    for (let i = 0; i < 15; i++) p.push(loud()); // 300 ms of speech, above the 250 ms minimum
    const clip = take.close(2);
    expect(clip).toMatchObject({ idx: 2, recStartMs: 4700, capture: "pcm", noSpeech: false });
    expect(clip?.durationMs).toBe(340); // 17 frames x 20 ms: the two silent frames are kept
    expect(clip?.wav?.size).toBe(44 + 2 * 17 * FRAME);
  });

  it("a window with no speech is marked noSpeech and makes no WAV", async () => {
    const { d, p } = deps();
    const take = startTakeCapture(d, 0, () => {});
    await take.ready;
    take.open(0, 0);
    for (let i = 0; i < 30; i++) p.push(silent());
    expect(take.close(0)).toMatchObject({ noSpeech: true, wav: null, voicedMs: null });
  });

  it("voiced_ms is the total of the speech runs (20 ms frames, runs of at least 250 ms)", async () => {
    const { d, p } = deps();
    const take = startTakeCapture(d, 0, () => {});
    await take.ready;
    take.open(0, 0);
    for (let i = 0; i < 20; i++) p.push(loud());
    expect(take.close(0)?.voicedMs).toBe(400);
  });

  it("a burst shorter than 250 ms is not speech", async () => {
    const { d, p } = deps();
    const take = startTakeCapture(d, 0, () => {});
    await take.ready;
    take.open(0, 0);
    for (let i = 0; i < 5; i++) p.push(loud());
    expect(take.close(0)?.noSpeech).toBe(true);
  });

  it("release frees the microphone; finish returns no extra clips on the PCM path", async () => {
    const { d, p } = deps();
    const take = startTakeCapture(d, 0, () => {});
    await take.ready;
    expect(await take.finish()).toEqual([]);
    expect(p.pcm.release).toHaveBeenCalled();
  });

  it("the track ending mid-take is an interruption: report once, release, stop", async () => {
    const { d, p } = deps();
    const onInterrupted = vi.fn();
    const take = startTakeCapture(d, 0, onInterrupted);
    await take.ready;
    take.open(0, 0);
    p.end();
    p.end();
    expect(onInterrupted).toHaveBeenCalledTimes(1);
    expect(p.pcm.release).toHaveBeenCalled();
    expect(take.close(0)).toBeNull();
  });

  it("going to the background is an interruption too", async () => {
    let hidden: (() => void) | null = null;
    const { d, p } = deps({ subscribeHidden: (cb) => { hidden = cb; return () => {}; } });
    const onInterrupted = vi.fn();
    const take = startTakeCapture(d, 0, onInterrupted);
    await take.ready;
    hidden?.();
    expect(onInterrupted).toHaveBeenCalledTimes(1);
    expect(p.pcm.release).toHaveBeenCalled();
  });
});

describe("take capture: MediaRecorder fallback (one recording, sliced after the take)", () => {
  it("chooses the recorder when decideCapture says so, and starts it synchronously", () => {
    const startRecorder = vi.fn(async (): Promise<RecordingLike> => ({
      stop: async () => ({ blob: new Blob([]), durationMs: 0 }), cancel: () => {},
    }));
    const { d } = deps({ decide: () => ({ mode: "media-recorder" }), startRecorder });
    const take = startTakeCapture(d, 0, () => {});
    expect(startRecorder).toHaveBeenCalledTimes(1);
    expect(take.mode).toBe("media-recorder");
  });

  it("finish stops the recording and cuts each window out of it, relative to the take start", async () => {
    const samples = new Float32Array(RATE * 3);
    for (let i = 0; i < samples.length; i++) samples[i] = i < RATE ? 0 : 0.5 * Math.sin(i / 3);
    const session: RecordingLike = {
      stop: vi.fn(async () => ({ blob: new Blob([new Uint8Array(4)]), durationMs: 3000 })),
      cancel: vi.fn(),
    };
    const { d } = deps({
      decide: () => ({ mode: "media-recorder" }),
      startRecorder: async () => session,
      toSamples: vi.fn(async () => samples),
    });
    const take = startTakeCapture(d, 1000, () => {});
    await take.ready;
    take.open(3, 2000);
    expect(take.close(3, 3000)).toBeNull(); // pending until finish (recorder path needs the close time)
    const clips = await take.finish();
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ idx: 3, recStartMs: 2000, capture: "recorder", noSpeech: false, durationMs: 1000 });
    expect(session.stop).toHaveBeenCalled();
  });
});
