import { describe, expect, it } from "vitest";
import { AudioConvertError, blobToArrayBuffer, toAssessmentWav, type ConvertDeps } from "./convert";
import { readWavInfo } from "./wav";
import { vi } from "vitest";
import { parseAssessmentWav } from "./convert";
import { encodeWavPcm16 } from "./wav";

const fakeBuffer = (duration: number) => ({ duration, length: Math.round(duration * 48000), sampleRate: 48000, numberOfChannels: 2 }) as AudioBuffer;

function deps(duration: number, samples?: Float32Array, fail = false): ConvertDeps & { rates: number[] } {
  const rates: number[] = [];
  return {
    rates,
    decode: async () => { if (fail) throw new Error("bad"); return fakeBuffer(duration); },
    render: async (_b, rate) => { rates.push(rate); return samples ?? new Float32Array(Math.round(duration * rate)); },
  };
}

const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });

describe("toAssessmentWav", () => {
  it("renders at 16 kHz and encodes WAV", async () => {
    const d = deps(2);
    const { wav, durationMs } = await toAssessmentWav(blob, d);
    expect(d.rates).toEqual([16000]);
    expect(wav.type).toBe("audio/wav");
    expect(readWavInfo(await blobToArrayBuffer(wav))).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16, durationMs: 2000 });
    expect(durationMs).toBe(2000);
  });
  it("rejects empty blobs and empty audio", async () => {
    await expect(toAssessmentWav(new Blob([]), deps(1))).rejects.toMatchObject({ code: "empty" });
    await expect(toAssessmentWav(blob, deps(0))).rejects.toMatchObject({ code: "empty" });
  });
  it("maps decode failures", async () => {
    await expect(toAssessmentWav(blob, deps(1, undefined, true))).rejects.toBeInstanceOf(AudioConvertError);
    await expect(toAssessmentWav(blob, deps(1, undefined, true))).rejects.toMatchObject({ code: "decode_failed" });
  });
  it("trims slight overshoot to 300 s and rejects far longer audio", async () => {
    const { wav, durationMs } = await toAssessmentWav(blob, deps(301, new Float32Array(301 * 16000)));
    expect(durationMs).toBe(300_000);
    expect(readWavInfo(await blobToArrayBuffer(wav)).dataBytes).toBe(300 * 16000 * 2);
    await expect(toAssessmentWav(blob, deps(320))).rejects.toMatchObject({ code: "too_long" });
  });
});

describe("16 kHz WAV fast path (plan 2026-10-07 Task 2.4)", () => {
  it("returns samples for 16 kHz mono 16-bit WAV and null otherwise", async () => {
    const wav = encodeWavPcm16(new Float32Array(1600).fill(0.5), 16000);
    const samples = parseAssessmentWav(await blobToArrayBuffer(new Blob([wav])));
    expect(samples?.length).toBe(1600);
    expect(samples?.[0]).toBeCloseTo(0.5, 3);
    expect(parseAssessmentWav(await blobToArrayBuffer(new Blob([encodeWavPcm16(new Float32Array(10), 44100)])))).toBeNull();
    expect(parseAssessmentWav(new ArrayBuffer(4))).toBeNull();
  });

  it("toAssessmentWav skips decoding for such WAVs", async () => {
    const decode = vi.fn();
    const wav = new Blob([encodeWavPcm16(new Float32Array(16000), 16000)], { type: "audio/wav" });
    const out = await toAssessmentWav(wav, { decode, render: vi.fn() });
    expect(decode).not.toHaveBeenCalled();
    expect(out.durationMs).toBe(1000);
    expect(out.wav).toBe(wav);
  });

  it("caps a long 16 kHz WAV at the maximum and rejects an empty one", async () => {
    const long = new Blob([encodeWavPcm16(new Float32Array(301 * 16000), 16000)], { type: "audio/wav" });
    const out = await toAssessmentWav(long, { decode: vi.fn(), render: vi.fn() });
    expect(out.durationMs).toBe(300_000);
    expect(readWavInfo(await blobToArrayBuffer(out.wav)).dataBytes).toBe(300 * 16000 * 2);
    const empty = new Blob([encodeWavPcm16(new Float32Array(0), 16000)], { type: "audio/wav" });
    await expect(toAssessmentWav(empty, { decode: vi.fn(), render: vi.fn() })).rejects.toMatchObject({ code: "empty" });
  });
});
