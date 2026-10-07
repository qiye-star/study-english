import { describe, expect, it } from "vitest";
import { Downsampler, concatFloat, dbfs, floatToPcm16, frameRms, pcm16ToFloat } from "./pcm";

const sine = (hz: number, rate: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

describe("Downsampler", () => {
  it.each([48000, 44100, 16000])("keeps a constant signal constant from %i Hz", (rate) => {
    const out = new Downsampler(rate).process(new Float32Array(rate).fill(0.25));
    expect(out.length).toBeGreaterThanOrEqual(15990);
    expect(out.length).toBeLessThanOrEqual(16000);
    expect(out.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);
  });

  it("gives the same result regardless of how the input is chunked", () => {
    const input = sine(440, 48000, 0.5);
    const whole = new Downsampler(48000).process(input);
    const d = new Downsampler(48000);
    const parts: Float32Array[] = [];
    for (let i = 0; i < input.length; i += 997) parts.push(d.process(input.subarray(i, i + 997)));
    expect(Array.from(concatFloat(parts))).toEqual(Array.from(whole));
  });

  it("keeps a 1 kHz tone (passband) and its level", () => {
    const out = new Downsampler(44100).process(sine(1000, 44100, 1));
    expect(frameRms(out)).toBeGreaterThan(0.3);
  });

  it("rejects upsampling", () => {
    expect(() => new Downsampler(8000)).toThrow(RangeError);
  });
});

describe("conversions", () => {
  it("clamps floats into int16", () => {
    expect(Array.from(floatToPcm16(Float32Array.from([1, -1, 2, -2, 0])))).toEqual([32767, -32768, 32767, -32768, 0]);
  });
  it("round-trips approximately", () => {
    const back = pcm16ToFloat(floatToPcm16(Float32Array.from([0.5, -0.25])));
    expect(back[0]).toBeCloseTo(0.5, 3);
    expect(back[1]).toBeCloseTo(-0.25, 3);
  });
  it("measures rms and dBFS", () => {
    expect(frameRms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5);
    expect(dbfs(1)).toBe(0);
    expect(dbfs(0)).toBe(-180);
    expect(dbfs(0.1)).toBeCloseTo(-20);
  });
});
