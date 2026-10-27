/**
 * zip 读取器(纯逻辑,不知道包格式)。
 *
 * 只读:文件尾部(EOCD / ZIP64 locator)、中央目录、被 `accept` 命中的条目的本地头(30 字节 + 名字 / 扩展长度)。
 * 条目数据不读进内存;`entryBlob` 返回 `Blob.slice` 视图,交给上传分片直接切。
 * 小文本(manifest / meta / srt)才会被读进内存,且有字节上限;DEFLATE 文本经 `DecompressionStream` 边读边数。
 * 本模块从不写文件系统。
 */

export type ZipReason =
  | "not_zip"
  | "truncated"
  | "malformed"
  | "encrypted"
  | "unsupported_method"
  | "multi_disk"
  | "too_many_entries"
  | "directory_too_large"
  | "bad_name"
  | "duplicate"
  | "overlap"
  | "out_of_bounds"
  | "too_large"
  | "deflate_unsupported";

export class ZipError extends Error {
  constructor(readonly reason: ZipReason) {
    super(reason);
    this.name = "ZipError";
  }
}

export interface ZipEntry {
  name: string;
  method: 0 | 8;
  compressedSize: number;
  size: number;
  /** 数据在文件里的起点(本地头之后) */
  dataStart: number;
}

export interface OpenZipOptions {
  /** 只为命中的条目读本地头;不命中的条目只参与结构检查。 */
  accept: (name: string) => boolean;
  /** 中央目录条目数上限(默认 5000)。 */
  maxEntries?: number;
  /** 中央目录字节上限(默认 8 MiB)。 */
  maxDirectoryBytes?: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CD = 0x02014b50;
const SIG_LFH = 0x04034b50;
const EOCD_MIN = 22;
const LOCATOR_LEN = 20;
const MAX_COMMENT = 65535;
const LFH_MIN = 30;
const CD_MIN = 46;
const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_MAX_DIRECTORY = 8 * 1024 * 1024;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

/** 读出 Blob 的全部字节。jsdom 的 Blob 没有 arrayBuffer(Task 0.5),所以缺失时退回 FileReader。 */
export function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof (blob as { arrayBuffer?: unknown }).arrayBuffer === "function") {
    return blob.arrayBuffer().then((b) => new Uint8Array(b));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(blob);
  });
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function u64(dv: DataView, off: number): number {
  const lo = dv.getUint32(off, true);
  const hi = dv.getUint32(off + 4, true);
  const v = hi * 0x100000000 + lo;
  if (!Number.isSafeInteger(v)) throw new ZipError("malformed");
  return v;
}

/** 路径安全检查:挡住 `..`、反斜杠、绝对路径、盘符、NUL 与控制字符(即使名字不被 accept)。 */
export function isSafeName(name: string): boolean {
  if (!name || name.length > 512) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(name)) return false;
  if (name.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  if (name.split("/").some((seg) => seg === "..")) return false;
  return true;
}

interface CdEntry {
  name: string;
  flags: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
  nameLen: number;
  extraLen: number;
}

/** 打开 zip:返回 `accept` 命中条目的表(按中央目录顺序)。失败抛 `ZipError`。 */
export async function openZip(blob: Blob, opts: OpenZipOptions): Promise<ZipEntry[]> {
  const size = blob.size;
  if (size < EOCD_MIN) throw new ZipError("not_zip");
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxDirectory = opts.maxDirectoryBytes ?? DEFAULT_MAX_DIRECTORY;

  // 1. 尾部:EOCD 在最后 22 + 注释长度处,前面可能有 ZIP64 locator
  const tailLen = Math.min(size, EOCD_MIN + MAX_COMMENT + LOCATOR_LEN);
  const tailStart = size - tailLen;
  const tail = await bytesOf(blob.slice(tailStart, size));
  const tdv = view(tail);
  let eocd = -1;
  for (let p = tail.length - EOCD_MIN; p >= 0; p--) {
    if (tdv.getUint32(p, true) !== SIG_EOCD) continue;
    const commentLen = tdv.getUint16(p + 20, true);
    if (p + EOCD_MIN + commentLen === tail.length) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("not_zip");

  let diskNo = tdv.getUint16(eocd + 4, true);
  let cdDisk = tdv.getUint16(eocd + 6, true);
  let count = tdv.getUint16(eocd + 10, true);
  let cdSize = tdv.getUint32(eocd + 12, true);
  let cdOffset = tdv.getUint32(eocd + 16, true);

  const hasLocator = eocd >= LOCATOR_LEN && tdv.getUint32(eocd - LOCATOR_LEN, true) === SIG_ZIP64_LOCATOR;
  const needsZip64 = count === U16_MAX || cdSize === U32_MAX || cdOffset === U32_MAX;
  if (hasLocator || needsZip64) {
    if (!hasLocator) throw new ZipError("malformed");
    const locAbs = tailStart + eocd - LOCATOR_LEN;
    const loc = view(tail.subarray(eocd - LOCATOR_LEN, eocd));
    if (loc.getUint32(16, true) > 1) throw new ZipError("multi_disk");
    const z64Pos = u64(loc, 8);
    if (z64Pos + 56 > locAbs) throw new ZipError("malformed");
    if (z64Pos + 56 > size) throw new ZipError("truncated");
    const rec = view(await bytesOf(blob.slice(z64Pos, z64Pos + 56)));
    if (rec.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new ZipError("malformed");
    diskNo = rec.getUint32(16, true);
    cdDisk = rec.getUint32(20, true);
    count = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }
  if (diskNo !== 0 || cdDisk !== 0) throw new ZipError("multi_disk");
  if (cdOffset + cdSize > size) throw new ZipError("truncated");
  if (cdSize > maxDirectory) throw new ZipError("directory_too_large");
  if (count > maxEntries) throw new ZipError("too_many_entries");

  // 2. 中央目录(整段读入,已有字节上限)
  const cd = await bytesOf(blob.slice(cdOffset, cdOffset + cdSize));
  const cdv = view(cd);
  const parsed: CdEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + CD_MIN > cd.length) throw new ZipError("malformed");
    if (cdv.getUint32(p, true) !== SIG_CD) throw new ZipError("malformed");
    const flags = cdv.getUint16(p + 8, true);
    const method = cdv.getUint16(p + 10, true);
    let compressed = cdv.getUint32(p + 20, true);
    let uncompressed = cdv.getUint32(p + 24, true);
    const nameLen = cdv.getUint16(p + 28, true);
    const extraLen = cdv.getUint16(p + 30, true);
    const commentLen = cdv.getUint16(p + 32, true);
    const diskStart = cdv.getUint16(p + 34, true);
    let offset = cdv.getUint32(p + 42, true);
    const nameStart = p + CD_MIN;
    const extraStart = nameStart + nameLen;
    const next = extraStart + extraLen + commentLen;
    if (next > cd.length) throw new ZipError("malformed");
    if (diskStart !== 0) throw new ZipError("multi_disk");

    if (uncompressed === U32_MAX || compressed === U32_MAX || offset === U32_MAX) {
      // ZIP64 扩展字段:按 size / compressed / offset 的顺序,只读被标记为 0xFFFFFFFF 的那些
      let q = extraStart;
      const qEnd = extraStart + extraLen;
      let found = false;
      while (q + 4 <= qEnd) {
        const id = cdv.getUint16(q, true);
        const len = cdv.getUint16(q + 2, true);
        const body = q + 4;
        if (body + len > qEnd) throw new ZipError("malformed");
        if (id === 0x0001) {
          let r = body;
          const need = (uncompressed === U32_MAX ? 8 : 0) + (compressed === U32_MAX ? 8 : 0) + (offset === U32_MAX ? 8 : 0);
          if (need > len) throw new ZipError("malformed");
          if (uncompressed === U32_MAX) {
            uncompressed = u64(cdv, r);
            r += 8;
          }
          if (compressed === U32_MAX) {
            compressed = u64(cdv, r);
            r += 8;
          }
          if (offset === U32_MAX) {
            offset = u64(cdv, r);
          }
          found = true;
          break;
        }
        q = body + len;
      }
      if (!found) throw new ZipError("malformed");
    }

    // 加密位(通用标志 bit 0、强加密 bit 6、掩码头 bit 13)
    if (flags & 0x1 || flags & 0x40 || flags & 0x2000) throw new ZipError("encrypted");
    if (method !== 0 && method !== 8) throw new ZipError("unsupported_method");
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(cd.subarray(nameStart, extraStart));
    } catch {
      throw new ZipError("bad_name");
    }
    if (!isSafeName(name)) throw new ZipError("bad_name");
    parsed.push({ name, flags, method, compressed, size: uncompressed, offset, nameLen, extraLen });
    p = next;
  }

  // 3. 区间检查:每条的「本地头 + 数据」必须在文件内、在中央目录之前,且两两不重叠(挡住重叠条目式 zip bomb)
  // 只用本地头的最小长度(30 + 名字)估计区间:中央目录里的扩展字段(如 ZIP64)不一定出现在本地头里,
  // 用它会把相邻条目误判为重叠。精确的数据起点在第 4 步对命中的条目再核对。
  const spans = parsed
    .map((e) => ({ start: e.offset, end: e.offset + LFH_MIN + e.nameLen + e.compressed }))
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].end > cdOffset) throw new ZipError("out_of_bounds");
    if (i > 0 && spans[i].start < spans[i - 1].end) throw new ZipError("overlap");
  }

  // 4. 只为命中的条目读本地头
  const out: ZipEntry[] = [];
  const seen = new Set<string>();
  for (const e of parsed) {
    if (!opts.accept(e.name)) continue;
    if (seen.has(e.name)) throw new ZipError("duplicate");
    seen.add(e.name);
    const lfh = view(await bytesOf(blob.slice(e.offset, e.offset + LFH_MIN)));
    if (lfh.getUint32(0, true) !== SIG_LFH) throw new ZipError("malformed");
    const dataStart = e.offset + LFH_MIN + lfh.getUint16(26, true) + lfh.getUint16(28, true);
    if (dataStart + e.compressed > cdOffset) throw new ZipError("out_of_bounds");
    if (e.method === 0 && e.compressed !== e.size) throw new ZipError("malformed");
    out.push({
      name: e.name,
      method: e.method as 0 | 8,
      compressedSize: e.compressed,
      size: e.size,
      dataStart,
    });
  }
  return out;
}

/** 条目数据的 Blob 视图(不读取字节)。 */
export function entryBlob(blob: Blob, entry: ZipEntry): Blob {
  return blob.slice(entry.dataStart, entry.dataStart + entry.compressedSize);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ZipError("malformed");
  }
}

/**
 * 读小文本条目(≤ cap 字节解压后)。STORE 直接读;DEFLATE 经 DecompressionStream 边读边数,
 * 超过 cap(或超过声明的解压大小)立刻中止。
 */
export async function readSmallText(blob: Blob, entry: ZipEntry, cap: number): Promise<string> {
  if (entry.size > cap || entry.compressedSize > cap) throw new ZipError("too_large");
  const raw = await bytesOf(entryBlob(blob, entry));
  if (entry.method === 0) return decodeUtf8(raw);
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (typeof DS === "undefined") throw new ZipError("deflate_unsupported");
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(raw);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DS("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > entry.size) {
      await reader.cancel();
      throw new ZipError("malformed");
    }
    if (total > cap) {
      await reader.cancel();
      throw new ZipError("too_large");
    }
    chunks.push(value);
  }
  if (total !== entry.size) throw new ZipError("malformed");
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return decodeUtf8(out);
}
