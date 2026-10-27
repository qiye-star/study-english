/**
 * 增量 MD5(RFC 1321),无依赖。用于导入包的完整性校验:媒体与字幕的字节 md5 与 manifest / meta 声明比对。
 * 只做校验,从不作为安全用途;md5 不进 URL、日志或本机存储。
 */
import { bytesOf } from "./zip-reader";

const SHIFT = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);

export class Md5 {
  private readonly h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]);
  private readonly buf = new Uint8Array(64);
  private bufLen = 0;
  private total = 0;

  update(data: Uint8Array): this {
    this.total += data.length;
    let i = 0;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      i = take;
      if (this.bufLen === 64) {
        this.block(this.buf, 0);
        this.bufLen = 0;
      }
    }
    for (; i + 64 <= data.length; i += 64) this.block(data, i);
    if (i < data.length) {
      this.buf.set(data.subarray(i), 0);
      this.bufLen = data.length - i;
    }
    return this;
  }

  /** 结束并返回 32 位小写十六进制。调用后对象不可再用。 */
  hex(): string {
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.bufLen < 56 ? 56 : 120) - this.bufLen) + 8);
    pad[0] = 0x80;
    const lo = bits % 0x100000000;
    const hi = Math.floor(bits / 0x100000000);
    const tail = pad.length - 8;
    for (let j = 0; j < 4; j++) {
      pad[tail + j] = (lo >>> (8 * j)) & 0xff;
      pad[tail + 4 + j] = (hi >>> (8 * j)) & 0xff;
    }
    const savedTotal = this.total;
    this.update(pad);
    this.total = savedTotal;
    let out = "";
    for (let w = 0; w < 4; w++) {
      for (let j = 0; j < 4; j++) out += ((this.h[w] >>> (8 * j)) & 0xff).toString(16).padStart(2, "0");
    }
    return out;
  }

  private block(m: Uint8Array, off: number) {
    const X = new Int32Array(16);
    for (let i = 0; i < 16; i++) {
      const p = off + 4 * i;
      X[i] = m[p] | (m[p + 1] << 8) | (m[p + 2] << 16) | (m[p + 3] << 24);
    }
    let a = this.h[0];
    let b = this.h[1];
    let c = this.h[2];
    let d = this.h[3];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + K[i] + X[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << SHIFT[i]) | (f >>> (32 - SHIFT[i])))) | 0;
    }
    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + b) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
  }
}

export function md5Hex(bytes: Uint8Array): string {
  return new Md5().update(bytes).hex();
}

const CHUNK = 4 * 1024 * 1024;

/**
 * 按 4 MiB 分块读 Blob 并计算 md5。`onProgress` 收到的是已读字节数(单调不减)。
 * 中止时抛 `AbortError`(DOMException)。
 */
export async function md5Blob(blob: Blob, opts: { signal?: AbortSignal; onProgress?: (bytesDone: number) => void } = {}): Promise<string> {
  const h = new Md5();
  const size = blob.size;
  for (let off = 0; off < size; off += CHUNK) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const end = Math.min(size, off + CHUNK);
    h.update(await bytesOf(blob.slice(off, end)));
    opts.onProgress?.(end);
  }
  if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
  if (size === 0) opts.onProgress?.(0);
  return h.hex();
}
