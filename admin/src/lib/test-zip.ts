/**
 * 测试专用:在内存里拼 zip(STORE / DEFLATE / ZIP64 / 注释 / 分卷号 / 加密位),用于 zip-reader 与包校验的测试。
 * 不被产品代码 import;生成结果是标准 zip,`unzip -t` 可读。
 */

export interface TestEntry {
  name: string;
  data: Uint8Array | string;
  /** 0 = STORE(默认),8 = DEFLATE(用 CompressionStream 压);其他值原样写入(测试拒收用)。 */
  method?: number;
  /** 通用标志位额外的位(例如 1 = 加密)。UTF-8 位总是打开。 */
  flags?: number;
  /** 覆盖中央目录里的本地头偏移(重叠条目测试用)。 */
  localOffset?: number;
  /** 覆盖中央目录里声明的解压大小(伪造大小测试用)。 */
  declaredSize?: number;
}

export interface TestZipOptions {
  comment?: string;
  /** 写 ZIP64 中央目录项扩展字段、ZIP64 EOCD 与 locator。 */
  zip64?: boolean;
  /** 覆盖 EOCD 的磁盘号(分卷测试用)。 */
  diskNumber?: number;
  /** 写入中央目录后、EOCD 之前额外附加的字节(截断 / 尾部垃圾测试用)。 */
  trailer?: Uint8Array;
}

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const src = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  const reader = src.pipeThrough(new CompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

class Bytes {
  parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  u16(v: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    this.push(b);
  }
  u32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.push(b);
  }
  u64(v: number) {
    const b = new Uint8Array(8);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, v % 0x100000000, true);
    dv.setUint32(4, Math.floor(v / 0x100000000), true);
    this.push(b);
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

/** 拼一个 zip。固定时间戳(0 / 1980-01-01),输出逐字节可复现。 */
export async function buildZip(entries: TestEntry[], opts: TestZipOptions = {}): Promise<Uint8Array> {
  const out = new Bytes();
  const cd: { name: Uint8Array; header: Bytes; flags: number }[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const method = e.method ?? 0;
    const body = method === 8 ? await deflateRaw(raw) : raw;
    const name = enc.encode(e.name);
    const flags = (e.flags ?? 0) | 0x800;
    const crc = crc32(raw);
    const local = new Bytes();
    local.u32(0x04034b50);
    local.u16(20);
    local.u16(flags);
    local.u16(method);
    local.u16(0);
    local.u16(0x21);
    local.u32(crc);
    local.u32(body.length);
    local.u32(raw.length);
    local.u16(name.length);
    local.u16(0);
    local.push(name);
    local.push(body);
    out.push(local.bytes());
    const localOffset = e.localOffset ?? offset;
    offset += local.length;

    const zip64 = !!opts.zip64;
    const fixed = new Bytes();
    fixed.u32(0x02014b50);
    fixed.u16(20);
    fixed.u16(20);
    fixed.u16(flags);
    fixed.u16(method);
    fixed.u16(0);
    fixed.u16(0x21);
    fixed.u32(crc);
    fixed.u32(zip64 ? 0xffffffff : body.length);
    fixed.u32(zip64 ? 0xffffffff : (e.declaredSize ?? raw.length));
    fixed.u16(name.length);
    const extra = new Bytes();
    if (zip64) {
      extra.u16(1);
      extra.u16(24);
      extra.u64(e.declaredSize ?? raw.length);
      extra.u64(body.length);
      extra.u64(localOffset);
    }
    fixed.u16(extra.length);
    fixed.u16(0); // comment length
    fixed.u16(0); // disk start
    fixed.u16(0); // internal attrs
    fixed.u32(0); // external attrs
    fixed.u32(zip64 ? 0xffffffff : localOffset);
    fixed.push(name);
    fixed.push(extra.bytes());
    cd.push({ name, header: fixed, flags });
  }
  const cdStart = offset;
  const cdBytes = new Bytes();
  for (const c of cd) cdBytes.push(c.header.bytes());
  out.push(cdBytes.bytes());
  const cdLen = cdBytes.length;
  if (opts.trailer) out.push(opts.trailer);
  const comment = enc.encode(opts.comment ?? "");
  let endPos = cdStart + cdLen + (opts.trailer?.length ?? 0);
  const disk = opts.diskNumber ?? 0;
  if (opts.zip64) {
    const z = new Bytes();
    z.u32(0x06064b50);
    z.u64(44);
    z.u16(45);
    z.u16(45);
    z.u32(disk);
    z.u32(0);
    z.u64(entries.length);
    z.u64(entries.length);
    z.u64(cdLen);
    z.u64(cdStart);
    const loc = new Bytes();
    loc.u32(0x07064b50);
    loc.u32(0);
    loc.u64(endPos);
    loc.u32(1);
    out.push(z.bytes());
    out.push(loc.bytes());
    endPos += z.length + loc.length;
    const eocd = new Bytes();
    eocd.u32(0x06054b50);
    eocd.u16(0xffff);
    eocd.u16(0xffff);
    eocd.u16(0xffff);
    eocd.u16(0xffff);
    eocd.u32(0xffffffff);
    eocd.u32(0xffffffff);
    eocd.u16(comment.length);
    out.push(eocd.bytes());
    out.push(comment);
  } else {
    const eocd = new Bytes();
    eocd.u32(0x06054b50);
    eocd.u16(disk);
    eocd.u16(0);
    eocd.u16(entries.length);
    eocd.u16(entries.length);
    eocd.u32(cdLen);
    eocd.u32(cdStart);
    eocd.u16(comment.length);
    out.push(eocd.bytes());
    out.push(comment);
  }
  return out.bytes();
}

export function blobOf(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart]);
}
