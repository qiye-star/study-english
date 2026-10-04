/// <reference types="vitest" />
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSESSMENT_SAMPLE_RATE, encodeWavPcm16, readWavInfo } from "./wav";

// @vitest-environment node

const ascii = (view: DataView, offset: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)));

describe("encodeWavPcm16", () => {
  it("writes a canonical 16 kHz mono 16-bit header", () => {
    const buffer = encodeWavPcm16(new Float32Array(16000), ASSESSMENT_SAMPLE_RATE);
    const v = new DataView(buffer);
    expect(buffer.byteLength).toBe(44 + 32000);
    expect(ascii(v, 0, 4)).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(36 + 32000);
    expect(ascii(v, 8, 4)).toBe("WAVE");
    expect(ascii(v, 12, 4)).toBe("fmt ");
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(v, 36, 4)).toBe("data");
    expect(v.getUint32(40, true)).toBe(32000);
  });

  it("converts and clamps samples", () => {
    const input = new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2, Number.NaN, Number.POSITIVE_INFINITY]);
    const v = new DataView(encodeWavPcm16(input, 16000));
    const out = Array.from({ length: input.length }, (_, i) => v.getInt16(44 + i * 2, true));
    expect(out).toEqual([0, 32767, -32768, 16384, -16384, 32767, -32768, 0, 0]);
  });

  it("handles empty input", () => {
    const buffer = encodeWavPcm16(new Float32Array(0), 16000);
    expect(buffer.byteLength).toBe(44);
    expect(readWavInfo(buffer)).toMatchObject({ dataBytes: 0, durationMs: 0 });
  });

  it("round-trips through readWavInfo", () => {
    expect(readWavInfo(encodeWavPcm16(new Float32Array(24000), 16000))).toEqual({
      format: 1, sampleRate: 16000, channels: 1, bitsPerSample: 16, dataBytes: 48000, durationMs: 1500,
    });
  });

  it("writes a sample for the server-side wave check", () => {
    const tone = Float32Array.from({ length: 16000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / 16000));
    const out = fileURLToPath(new URL("../../test-results/encoder-sample.wav", import.meta.url));
    mkdirSync(fileURLToPath(new URL("../../test-results/", import.meta.url)), { recursive: true });
    writeFileSync(out, Buffer.from(encodeWavPcm16(tone, 16000)));
  });
});

describe("readWavInfo", () => {
  it("reads the repository's 16 kHz sample (enjoy/samples/jfk.wav)", () => {
    const file = readFileSync(fileURLToPath(new URL("../../../enjoy/samples/jfk.wav", import.meta.url)));
    const info = readWavInfo(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    expect(info).toMatchObject({ format: 1, sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    expect(Math.abs(info.durationMs - 11000)).toBeLessThan(100);
  });
  it("rejects non-WAV data", () => {
    expect(() => readWavInfo(new TextEncoder().encode("ID3 not a wav file").buffer)).toThrow("Not a WAV file");
  });
});
