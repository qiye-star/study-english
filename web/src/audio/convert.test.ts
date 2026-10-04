import { describe, expect, it } from "vitest";
import { AudioConvertError, blobToArrayBuffer, toAssessmentWav, type ConvertDeps } from "./convert";
import { readWavInfo } from "./wav";

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
