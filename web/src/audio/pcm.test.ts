import { describe, expect, it } from "vitest";
import { Downsampler, concatFloat, dbfs, floatToPcm16, frameRms, pcm16ToFloat } from "./pcm";

const sine = (hz: number, rate: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

/** 整段降采样:process 全部输入 + flush。 */
const downsampleAll = (rate: number, input: Float32Array) => {
  const d = new Downsampler(rate);
  return concatFloat([d.process(input), d.flush()]);
};
/** 输出里稳态部分(去掉两端各 0.1 s)的增益,单位 dB(相对输入正弦的 RMS)。 */
function gainDb(rate: number, hz: number) {
  const amp = 0.5;
  const out = downsampleAll(rate, sine(hz, rate, 1, amp));
  const steady = out.subarray(1600, out.length - 1600);
  return 20 * Math.log10(frameRms(steady) / (amp / Math.SQRT2));
}

const RATES = [48000, 44100, 32000, 24000, 22050];

describe("Downsampler (windowed-sinc FIR anti-aliasing, review W1 M-1)", () => {
  it.each([...RATES, 16000])("keeps a constant signal constant from %i Hz, edges included", (rate) => {
    const out = downsampleAll(rate, new Float32Array(rate).fill(0.25));
    expect(out.length).toBe(16000);
    expect(out.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);
  });

  it("produces exactly ceil(n · 16000 / rate) samples with no drift over a minute at 44.1 kHz", () => {
    const d = new Downsampler(44100);
    let total = 0;
    const chunk = new Float32Array(2048);
    let fed = 0;
    while (fed < 44100 * 60) {
      const n = Math.min(2048, 44100 * 60 - fed);
      total += d.process(chunk.subarray(0, n)).length;
      fed += n;
    }
    total += d.flush().length;
    expect(total).toBe(960000);
  });

  describe.each(RATES)("from %i Hz", (rate) => {
    it.each([1, 128, 997, 2048, 4096])("is bit-identical however the input is chunked (chunks of %i)", (size) => {
      const input = concatFloat([sine(440, rate, 0.15), sine(5000, rate, 0.15, 0.3), sine(9000, rate, 0.1, 0.2)]);
      const whole = downsampleAll(rate, input);
      const d = new Downsampler(rate);
      const parts: Float32Array[] = [];
      for (let i = 0; i < input.length; i += size) parts.push(d.process(input.subarray(i, i + size)));
      parts.push(d.flush());
      expect(Array.from(concatFloat(parts))).toEqual(Array.from(whole));
    });

    it("attenuates a 10 kHz tone (which would alias to 6 kHz) by at least 30 dB", () => {
      expect(gainDb(rate, 10000)).toBeLessThanOrEqual(-30);
    });

    it("keeps 3 kHz within 1 dB and 6 kHz within 3 dB", () => {
      expect(Math.abs(gainDb(rate, 3000))).toBeLessThanOrEqual(1);
      expect(Math.abs(gainDb(rate, 6000))).toBeLessThanOrEqual(3);
    });
  });

  it("passes 16 kHz through unchanged", () => {
    const input = sine(1000, 16000, 0.1);
    const d = new Downsampler(16000);
    expect(Array.from(d.process(input))).toEqual(Array.from(input));
    expect(d.flush().length).toBe(0);
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
