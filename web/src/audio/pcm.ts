export const TARGET_RATE = 16000;

/** 抗混叠低通的截止频率(Hz)与半宽(以输出采样计)。Kaiser 窗 β≈5.65 ≈ 60 dB 阻带,过渡带约 ±0.8 kHz。 */
export const DOWNSAMPLE_CUTOFF_HZ = 7200;
const HALF_WIDTH = 18;
const KAISER_BETA = 5.65;
const MAX_CACHED_PHASES = 4096;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 50; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

interface Kernel {
  /** 第一个抽头相对 pos 的输入下标偏移 */
  first: number;
  /** 未归一化的权重(归一化在用时做,便于边缘裁剪后重新归一) */
  w: Float64Array;
  sum: number;
}

/**
 * 加窗 sinc(Kaiser)FIR 抗混叠低通 + 有理数比例抽取(多相),替代原先的区间平均(review W1 M-1;
 * 控制者裁定:发音评测在意音质,R9 的"盒式低通 + 线性插值"措辞以此为准被取代)。
 * - 输出第 n 个采样位于输入位置 n·inRate/outRate,用整数相位精确推进,无漂移;
 * - 跨调用保留历史样本,输出与分块方式无关(逐位一致);
 * - 流开头之前/flush 时流末尾之后的抽头被丢弃并重新归一化,常数信号在边缘也保持不变;
 * - 有约 HALF_WIDTH 个输出采样(~1 ms)的延迟:结束时调用 flush() 取回尾部。
 */
export class Downsampler {
  private readonly p: number; // 每个输出采样前进 p/q 个输入采样
  private readonly q: number;
  private readonly half: number; // 输入采样计的半宽
  private readonly cutoff: number; // 归一化到输入采样率的截止(周期/采样)
  private readonly kernels = new Map<number, Kernel>();
  private buf = new Float32Array(0);
  private bufStart = 0; // buf[0] 在整个输入流里的下标
  private total = 0; // 已收到的输入采样数
  private pos = 0; // 下一个输出采样中心的整数部分(输入下标)
  private phase = 0; // 小数部分 = phase / q

  constructor(readonly inRate: number, readonly outRate = TARGET_RATE) {
    if (inRate < outRate) throw new RangeError("input rate is below the output rate");
    const inR = Math.round(inRate);
    const outR = Math.round(outRate);
    const g = gcd(inR, outR);
    this.p = inR / g;
    this.q = outR / g;
    const ratio = inR / outR;
    this.half = HALF_WIDTH * ratio;
    this.cutoff = Math.min(DOWNSAMPLE_CUTOFF_HZ, outR / 2) / inR;
  }

  private kernel(phase: number): Kernel {
    const cached = this.kernels.get(phase);
    if (cached) return cached;
    const frac = phase / this.q;
    const first = Math.ceil(frac - this.half);
    const last = Math.floor(frac + this.half);
    const w = new Float64Array(last - first + 1);
    const i0b = besselI0(KAISER_BETA);
    let sum = 0;
    for (let j = 0; j < w.length; j++) {
      const x = first + j - frac; // 相对中心的输入采样距离
      const r = x / this.half;
      if (Math.abs(r) >= 1) continue;
      const arg = 2 * this.cutoff * x;
      const sinc = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
      w[j] = sinc * (besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / i0b);
      sum += w[j];
    }
    const k = { first, w, sum };
    if (this.q <= MAX_CACHED_PHASES) this.kernels.set(phase, k);
    return k;
  }

  /** 计算当前输出采样;`end` 之后(不含)的输入视为不存在。 */
  private sample(k: Kernel, end: number): number {
    const lo = this.pos + k.first;
    let acc = 0;
    if (lo >= 0 && lo + k.w.length <= end) {
      const at = lo - this.bufStart;
      for (let j = 0; j < k.w.length; j++) acc += k.w[j] * this.buf[at + j];
      return acc / k.sum;
    }
    let used = 0; // 流的起点/终点:丢弃越界抽头并重新归一化
    for (let j = 0; j < k.w.length; j++) {
      const i = lo + j;
      if (i < 0 || i >= end) continue;
      acc += k.w[j] * this.buf[i - this.bufStart];
      used += k.w[j];
    }
    return used > 0 ? acc / used : 0;
  }

  private advance() {
    this.phase += this.p;
    this.pos += Math.floor(this.phase / this.q);
    this.phase %= this.q;
  }

  process(input: Float32Array): Float32Array {
    if (this.p === this.q) return input.slice();
    const buf = new Float32Array(this.buf.length + input.length);
    buf.set(this.buf);
    buf.set(input, this.buf.length);
    this.buf = buf;
    this.total += input.length;
    const out: number[] = [];
    for (;;) {
      const k = this.kernel(this.phase);
      if (this.pos + k.first + k.w.length > this.total) break;
      out.push(this.sample(k, this.total));
      this.advance();
    }
    const keepFrom = Math.max(this.bufStart, this.pos - Math.ceil(this.half) - 1);
    this.buf = this.buf.slice(keepFrom - this.bufStart);
    this.bufStart = keepFrom;
    return Float32Array.from(out);
  }

  /** 输入结束:输出剩余的尾部采样(中心仍落在输入范围内的那些)。之后不应再调用 process。 */
  flush(): Float32Array {
    if (this.p === this.q) return new Float32Array(0);
    const out: number[] = [];
    while (this.pos < this.total) {
      out.push(this.sample(this.kernel(this.phase), this.total));
      this.advance();
    }
    this.buf = new Float32Array(0);
    this.bufStart = this.total;
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
