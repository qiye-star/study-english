import { describe, expect, it } from "vitest";
import { MIN_SPEECH_MS, PAD_MS, frameLevels, hasForegroundSpeech, speechRuns, trimSilence } from "./energy-gate";
import { dbfs, frameRms } from "./pcm";

const RATE = 16000;
/** 固定种子的伪随机数(mulberry32),不使用 Math.random。 */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** "人声"替身:基频 + 两个谐波,按 4 Hz 音节包络轻微起伏(±1.5 dB),整体缩放到给定的 RMS dBFS */
function voice(seconds: number, db: number, seed: number): Float32Array {
  const r = rng(seed);
  const f0 = 120 + 80 * r();
  const raw = Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => {
    const t = i / RATE;
    const env = 0.85 + 0.15 * Math.sin(2 * Math.PI * 4 * t);
    return env * (0.7 * Math.sin(2 * Math.PI * f0 * t) + 0.2 * Math.sin(4 * Math.PI * f0 * t) + 0.1 * Math.sin(6 * Math.PI * f0 * t));
  });
  const scale = 10 ** (db / 20) / frameRms(raw);
  return raw.map((v) => v * scale);
}
function noise(seconds: number, db: number, seed: number): Float32Array {
  const r = rng(seed);
  const a = 10 ** (db / 20) * Math.sqrt(3); // 均匀分布 RMS = a/√3
  return Float32Array.from({ length: Math.round(seconds * RATE) }, () => a * (2 * r() - 1));
}
const mix = (...xs: Float32Array[]) => Float32Array.from({ length: Math.max(...xs.map((x) => x.length)) }, (_, i) => xs.reduce((s, x) => s + (x[i] ?? 0), 0));
const concat = (...xs: Float32Array[]) => Float32Array.from(xs.flatMap((x) => Array.from(x)));
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));
const opts = { sampleRate: RATE };

describe("synthetic noise conditions (design §7.2)", () => {
  it("background voices alone (-45 dBFS babble over -55 dBFS noise) are not speech", () => {
    const babble = mix(voice(3, -48, 1), voice(3, -49, 2), voice(3, -50, 3), noise(3, -55, 4));
    expect(dbfs(frameRms(babble))).toBeLessThan(-40);
    expect(hasForegroundSpeech(babble, opts)).toBe(false);
    expect(trimSilence(babble, opts).length).toBe(0);
  });

  it("pure noise is not speech", () => {
    for (const db of [-70, -55, -45]) {
      const n = noise(3, db, 20);
      expect(hasForegroundSpeech(n, opts)).toBe(false);
      expect(trimSilence(n, opts).length).toBe(0);
    }
  });

  it.each([[-15, "loud near speaker"], [-25, "normal near speaker"], [-32, "quiet near speaker"]])(
    "foreground at %i dBFS over background babble is kept (%s)", (db) => {
      const background = mix(voice(3, -48, 5), noise(3, -55, 6));
      const signal = mix(background, concat(silence(1), voice(1, db, 7), silence(1)));
      expect(hasForegroundSpeech(signal, opts)).toBe(true);
      const trimmed = trimSilence(signal, opts);
      // 1 s 语音 + 两侧各 200 ms(按 20 ms 帧取整,允许 ±2 帧)
      expect(trimmed.length / RATE).toBeGreaterThan(1.4 - 0.04 - 0.1);
      expect(trimmed.length / RATE).toBeLessThan(1.4 + 0.04 + 0.1);
    });

  it("a far speaker below the near-field threshold is rejected (documented limitation)", () => {
    expect(hasForegroundSpeech(mix(voice(2, -42, 8), noise(2, -55, 9)), opts)).toBe(false);
  });

  it("a short loud click is not speech", () => {
    expect(hasForegroundSpeech(concat(silence(0.5), voice(0.1, -10, 10), silence(0.5)), opts)).toBe(false);
  });

  it("speech just over the minimum duration counts", () => {
    expect(hasForegroundSpeech(concat(silence(0.5), voice(MIN_SPEECH_MS / 1000 + 0.06, -20, 11), silence(0.5)), opts)).toBe(true);
  });

  it("is deterministic: the same seed yields the same signal and decision", () => {
    const a = mix(voice(1, -25, 3), noise(1, -55, 4));
    const b = mix(voice(1, -25, 3), noise(1, -55, 4));
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(hasForegroundSpeech(a, opts)).toBe(hasForegroundSpeech(b, opts));
  });
});

describe("edge cases", () => {
  it("handles an empty array", () => {
    const empty = new Float32Array(0);
    expect(frameLevels(empty, RATE)).toEqual([]);
    expect(hasForegroundSpeech(empty, opts)).toBe(false);
    expect(trimSilence(empty, opts).length).toBe(0);
  });

  it("treats all-zero samples as silence", () => {
    const z = silence(2);
    expect(hasForegroundSpeech(z, opts)).toBe(false);
    expect(trimSilence(z, opts).length).toBe(0);
    expect(frameLevels(z, RATE).every((l) => Number.isFinite(l) && l < -100)).toBe(true);
  });

  it("keeps clipped (full-scale) speech and never reads past the buffer", () => {
    const clipped = voice(1, -3, 13).map((v) => Math.max(-1, Math.min(1, v * 4)));
    const s = concat(silence(0.3), clipped, silence(0.3));
    expect(hasForegroundSpeech(s, opts)).toBe(true);
    const t = trimSilence(s, opts);
    expect(t.length).toBeGreaterThan(RATE);
    expect(t.length).toBeLessThanOrEqual(s.length);
  });

  it("treats full-scale DC as loud, not as NaN", () => {
    const sq = new Float32Array(RATE).fill(1);
    expect(frameLevels(sq, RATE).every((l) => Math.abs(l) < 0.01)).toBe(true);
    expect(hasForegroundSpeech(sq, opts)).toBe(true);
  });

  it("rejects very short inputs", () => {
    expect(hasForegroundSpeech(new Float32Array([0.9]), opts)).toBe(false);
    expect(hasForegroundSpeech(voice(0.01, -10, 14), opts)).toBe(false);
    expect(trimSilence(voice(0.2, -10, 15), opts).length).toBe(0);
  });

  it("handles a trailing partial frame", () => {
    const s = concat(voice(0.5, -20, 16), new Float32Array(37));
    expect(hasForegroundSpeech(s, opts)).toBe(true);
    expect(trimSilence(s, opts).length).toBeLessThanOrEqual(s.length);
  });
});

describe("building blocks", () => {
  it("frames every 20 ms", () => {
    expect(frameLevels(silence(1), RATE)).toHaveLength(50);
  });
  it("finds runs of at least minFrames above the threshold", () => {
    const L = [-60, -20, -20, -60, -20, -20, -20, -20, -60];
    expect(speechRuns(L, -38, 3)).toEqual([[4, 8]]);
    expect(speechRuns(L, -38, 2)).toEqual([[1, 3], [4, 8]]);
  });
  it("closes a run that reaches the end of the levels", () => {
    expect(speechRuns([-60, -20, -20, -20], -38, 3)).toEqual([[1, 4]]);
  });
  it("pads trimmed speech and clamps at the edges", () => {
    const s = concat(voice(0.5, -20, 12), silence(1));
    const trimmed = trimSilence(s, { sampleRate: RATE, padMs: PAD_MS });
    expect(trimmed.length / RATE).toBeCloseTo(0.7, 1);
  });
});
