import { ASSESSMENT_SAMPLE_RATE, encodeWavPcm16 } from "./wav";

export const MAX_RECORDING_MS = 300_000;
const HARD_LIMIT_MS = MAX_RECORDING_MS + 5_000;

export type AudioConvertErrorCode = "decode_failed" | "empty" | "too_long";

export class AudioConvertError extends Error {
  constructor(public readonly code: AudioConvertErrorCode) {
    super(code);
    this.name = "AudioConvertError";
  }
}

export interface ConvertDeps {
  decode(data: ArrayBuffer): Promise<AudioBuffer>;
  render(buffer: AudioBuffer, sampleRate: number): Promise<Float32Array>;
}

type OfflineCtor = typeof OfflineAudioContext;

function offlineCtor(): OfflineCtor | undefined {
  return (
    (globalThis as { OfflineAudioContext?: OfflineCtor }).OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext
  );
}

/** 用 OfflineAudioContext 解码(不占用 iOS 有限的 AudioContext 名额);兼容回调与 Promise 两种形式。 */
export function decodeWithOfflineContext(data: ArrayBuffer): Promise<AudioBuffer> {
  const Ctor = offlineCtor();
  if (!Ctor) return Promise.reject(new Error("OfflineAudioContext is not supported"));
  const ctx = new Ctor(1, 1, 44100);
  return new Promise((resolve, reject) => {
    try {
      const maybe = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
      if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

/** 渲染成单声道(多声道按规范自动下混)并重采样到 sampleRate。 */
export async function renderMono(buffer: AudioBuffer, sampleRate: number): Promise<Float32Array> {
  const Ctor = offlineCtor();
  if (!Ctor) throw new Error("OfflineAudioContext is not supported");
  const length = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const ctx = new Ctor(1, length, sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

export const browserConvertDeps: ConvertDeps = { decode: decodeWithOfflineContext, render: renderMono };

export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** MediaRecorder 产物(webm/opus、mp4/aac 等)→ 16 kHz 单声道 16 位 WAV。 */
export async function toAssessmentWav(blob: Blob, deps: ConvertDeps = browserConvertDeps): Promise<{ wav: Blob; durationMs: number }> {
  if (blob.size === 0) throw new AudioConvertError("empty");
  const data = await blobToArrayBuffer(blob);
  let decoded: AudioBuffer;
  try {
    decoded = await deps.decode(data);
  } catch {
    throw new AudioConvertError("decode_failed");
  }
  if (!decoded || !decoded.length || !decoded.duration) throw new AudioConvertError("empty");
  if (decoded.duration * 1000 > HARD_LIMIT_MS) throw new AudioConvertError("too_long");
  let samples = await deps.render(decoded, ASSESSMENT_SAMPLE_RATE);
  const maxSamples = (MAX_RECORDING_MS / 1000) * ASSESSMENT_SAMPLE_RATE;
  if (samples.length > maxSamples) samples = samples.subarray(0, maxSamples);
  if (!samples.length) throw new AudioConvertError("empty");
  return {
    wav: new Blob([encodeWavPcm16(samples, ASSESSMENT_SAMPLE_RATE)], { type: "audio/wav" }),
    durationMs: Math.round((samples.length / ASSESSMENT_SAMPLE_RATE) * 1000),
  };
}
