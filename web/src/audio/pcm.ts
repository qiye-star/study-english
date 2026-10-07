export const TARGET_RATE = 16000;

/** 区间平均降采样(盒式低通 + 抽取);跨调用保持连续,结果与分块方式无关。 */
export class Downsampler {
  private pending = new Float32Array(0);
  private consumed = 0; // pending[0] 在整个输入流里的下标
  private next = 0; // 下一个输出采样在输入流里的起点(小数)
  private readonly ratio: number;

  constructor(readonly inRate: number, readonly outRate = TARGET_RATE) {
    if (inRate < outRate) throw new RangeError("input rate is below the output rate");
    this.ratio = inRate / outRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice();
    const buf = new Float32Array(this.pending.length + input.length);
    buf.set(this.pending);
    buf.set(input, this.pending.length);
    const out: number[] = [];
    for (;;) {
      const start = this.next - this.consumed;
      const end = start + this.ratio;
      const hi = Math.ceil(end);
      if (hi > buf.length) break;
      let sum = 0;
      const lo = Math.floor(start);
      for (let i = lo; i < hi; i++) sum += buf[i];
      out.push(sum / (hi - lo));
      this.next += this.ratio;
    }
    const keep = Math.floor(this.next - this.consumed);
    this.pending = buf.slice(keep);
    this.consumed += keep;
    return Float32Array.from(out);
  }
}

export function floatToPcm16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function pcm16ToFloat(i16: Int16Array): Float32Array {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 0x8000;
  return out;
}

export function frameRms(f: Float32Array): number {
  if (!f.length) return 0;
  let sum = 0;
  for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
  return Math.sqrt(sum / f.length);
}

export function dbfs(rms: number): number {
  return rms <= 0 ? -180 : Math.max(-180, 20 * Math.log10(rms));
}

export function concatFloat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
