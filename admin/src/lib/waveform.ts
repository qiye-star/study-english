/** 波形与播放速度的纯逻辑;与 DOM / Web Audio 解耦,便于测试。 */

/** 可选的播放速度,按顺序循环:1x → 1.25x → 0.75x → 1x */
export const PLAYBACK_RATES = [1, 1.25, 0.75] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export function nextRate(rate: number): PlaybackRate {
  const i = PLAYBACK_RATES.indexOf(rate as PlaybackRate);
  return PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
}

export function formatRate(rate: number): string {
  return `${rate % 1 === 0 ? rate.toFixed(0) : String(rate)}×`;
}

/**
 * 把多声道采样压成 `buckets` 个峰值(0..1)。
 * 每个桶取其区间内所有声道样本的绝对值最大值,再按全局峰值归一化;静音返回全 0。
 */
export function computePeaks(channels: ArrayLike<number>[], buckets: number): number[] {
  const n = Math.max(0, Math.floor(buckets));
  if (n === 0) return [];
  const length = channels.reduce((m, c) => Math.max(m, c.length), 0);
  if (length === 0 || channels.length === 0) return new Array<number>(n).fill(0);
  const out = new Array<number>(n).fill(0);
  const step = length / n;
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * step);
    const end = Math.max(start + 1, Math.floor((b + 1) * step));
    let peak = 0;
    for (const ch of channels) {
      const stop = Math.min(end, ch.length);
      for (let i = start; i < stop; i++) {
        const v = Math.abs(ch[i]);
        if (v > peak) peak = v;
      }
    }
    out[b] = peak;
  }
  const max = out.reduce((m, v) => Math.max(m, v), 0);
  if (max === 0) return out;
  return out.map((v) => v / max);
}

/**
 * 解不出音频(格式不支持、无 AudioContext)时的占位波形:
 * 确定性的、看起来像语音包络的低幅伪波形,保证 UI 不塌。
 */
export function placeholderPeaks(buckets: number, seed = 1): number[] {
  const n = Math.max(0, Math.floor(buckets));
  const out: number[] = [];
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const noise = (s / 0xffffffff) * 0.25;
    const envelope = 0.35 + 0.3 * Math.sin((i / n) * Math.PI * 3) ** 2;
    out.push(Math.min(1, Math.max(0.08, envelope * (0.6 + noise))));
  }
  return out;
}

function toArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  // 老 WebKit 没有 Blob.arrayBuffer
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

type DecodeContext = { decodeAudioData(buf: ArrayBuffer): Promise<AudioBuffer>; close?: () => Promise<void> };

/**
 * 用 Web Audio 解码 blob 并算峰值;浏览器不支持或解码失败时返回 null,由调用方回退。
 * 解码上下文用完即关,避免在 iOS 上占用音频硬件。
 */
export async function decodePeaks(blob: Blob, buckets: number): Promise<number[] | null> {
  const Ctor = (globalThis as { AudioContext?: new () => DecodeContext; webkitAudioContext?: new () => DecodeContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: new () => DecodeContext }).webkitAudioContext;
  if (!Ctor) return null;
  let ctx: DecodeContext | null = null;
  try {
    ctx = new Ctor();
    const buf = await ctx.decodeAudioData(await toArrayBuffer(blob));
    const channels: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
    return computePeaks(channels, buckets);
  } catch {
    return null;
  } finally {
    void ctx?.close?.().catch(() => {});
  }
}
