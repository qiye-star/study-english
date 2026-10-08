import { describe, expect, it } from "vitest";
import { computePeaks, decodePeaks, formatRate, nextRate, placeholderPeaks, PLAYBACK_RATES } from "./waveform";

describe("computePeaks", () => {
  it("returns one normalised peak per bucket using the absolute maximum", () => {
    const ch = Float64Array.from([0.1, -0.5, 0.2, 0.25, 0, -1, 0.3, 0.1]);
    expect(computePeaks([ch], 4)).toEqual([0.5, 0.25, 1, 0.3]);
  });

  it("merges channels by taking the loudest sample across them", () => {
    const left = Float32Array.from([0.2, 0.2, 0.2, 0.2]);
    const right = Float32Array.from([0.0, 0.8, 0.0, 0.0]);
    expect(computePeaks([left, right], 2)).toEqual([1, 0.25]);
  });

  it("handles more buckets than samples without gaps", () => {
    const peaks = computePeaks([Float32Array.from([1, 0])], 4);
    expect(peaks).toHaveLength(4);
    expect(peaks.every((p) => p >= 0 && p <= 1)).toBe(true);
    expect(Math.max(...peaks)).toBe(1);
  });

  it("returns zeros for silence and an empty array for zero buckets", () => {
    expect(computePeaks([new Float32Array(10)], 3)).toEqual([0, 0, 0]);
    expect(computePeaks([], 3)).toEqual([0, 0, 0]);
    expect(computePeaks([Float32Array.from([1])], 0)).toEqual([]);
  });
});

describe("placeholderPeaks", () => {
  it("is deterministic and stays inside a visible band", () => {
    const a = placeholderPeaks(32, 7);
    expect(a).toEqual(placeholderPeaks(32, 7));
    expect(a).toHaveLength(32);
    expect(a.every((p) => p >= 0.08 && p <= 1)).toBe(true);
  });
});

describe("playback rate", () => {
  it("cycles 1x → 1.25x → 0.75x → 1x", () => {
    expect(nextRate(1)).toBe(1.25);
    expect(nextRate(1.25)).toBe(0.75);
    expect(nextRate(0.75)).toBe(1);
  });

  it("recovers to the first rate from an unknown value", () => {
    expect(nextRate(2)).toBe(PLAYBACK_RATES[0]);
  });

  it("formats rates compactly", () => {
    expect(formatRate(1)).toBe("1×");
    expect(formatRate(1.25)).toBe("1.25×");
    expect(formatRate(0.75)).toBe("0.75×");
  });
});

describe("decodePeaks", () => {
  it("returns null when Web Audio is unavailable (jsdom)", async () => {
    expect(await decodePeaks(new Blob(["RIFF"]), 16)).toBeNull();
  });

  it("decodes through AudioContext when present and closes the context", async () => {
    const closed: boolean[] = [];
    class FakeCtx {
      async decodeAudioData() {
        return {
          numberOfChannels: 1,
          getChannelData: () => Float32Array.from([0, 0.5, 1, 0.5]),
        } as unknown as AudioBuffer;
      }
      async close() {
        closed.push(true);
      }
    }
    const g = globalThis as { AudioContext?: unknown };
    g.AudioContext = FakeCtx;
    try {
      expect(await decodePeaks(new Blob(["x"]), 2)).toEqual([0.5, 1]);
      expect(closed).toEqual([true]);
    } finally {
      delete g.AudioContext;
    }
  });

  it("returns null when decoding throws", async () => {
    class BadCtx {
      async decodeAudioData(): Promise<AudioBuffer> {
        throw new Error("unsupported");
      }
      async close() {}
    }
    const g = globalThis as { AudioContext?: unknown };
    g.AudioContext = BadCtx;
    try {
      expect(await decodePeaks(new Blob(["x"]), 2)).toBeNull();
    } finally {
      delete g.AudioContext;
    }
  });
});
