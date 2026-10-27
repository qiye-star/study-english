// Streaming, STORE-only ZIP writer for the Enjoy export package (plan R-P5, R-E8).
//
// Each member is read twice from its source: once to learn size, CRC-32 and MD5 (needed
// for the local header, since no data descriptor is written), once to copy the bytes.
// If the second read differs from the first, the source changed during export -> read_error.
// Writes go to `<out>.partial` and are renamed to `<out>` only by finish().
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { ExportError } from './errors.mjs';

const CHUNK = 64 * 1024;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

function toDos(d) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

function zip64Extra(values) {
  const b = Buffer.alloc(4 + 8 * values.length);
  b.writeUInt16LE(0x0001, 0);
  b.writeUInt16LE(8 * values.length, 2);
  values.forEach((v, i) => b.writeBigUInt64LE(BigInt(v), 4 + 8 * i));
  return b;
}

function checkAborted(signal) {
  if (signal?.aborted) throw new ExportError('aborted', 'export aborted');
}

async function readFully(srcPath, signal, onChunk) {
  try {
    for await (const chunk of createReadStream(srcPath, { highWaterMark: CHUNK })) {
      checkAborted(signal);
      onChunk(chunk);
    }
  } catch (err) {
    if (err instanceof ExportError) throw err;
    throw new ExportError('read_error', `cannot read media: ${err.code ?? 'IO error'}`);
  }
}

async function hashFile(srcPath, signal) {
  const md5 = createHash('md5');
  let crc = 0;
  let size = 0;
  await readFully(srcPath, signal, (chunk) => {
    md5.update(chunk);
    crc = crc32(chunk, crc);
    size += chunk.length;
  });
  return { size, crc32: crc >>> 0, md5: md5.digest('hex') };
}

export async function createZipWriter(outPath, opts = {}) {
  const { now = new Date(), forceZip64 = false, signal, afterFirstPass } = opts;
  const partial = `${outPath}.partial`;
  const dos = toDos(now);
  const fh = await open(partial, 'w');
  const entries = [];
  let pos = 0;
  let done = false; // finished or aborted; no further writes

  async function writeAll(buf) {
    let off = 0;
    while (off < buf.length) {
      const { bytesWritten } = await fh.write(buf, off, buf.length - off, pos);
      pos += bytesWritten;
      off += bytesWritten;
    }
  }

  async function abort() {
    if (done) return;
    done = true;
    try { await fh.close(); } catch { /* already closed */ }
    await rm(partial, { force: true });
  }

  function guard() {
    if (done) throw new ExportError('write_error', 'zip writer is closed');
  }

  // Writes local header + data for one member whose size and CRC are known up front.
  async function writeMember(nameBuf, size, crc, dataStream) {
    const offset = pos;
    const sizeZ = forceZip64 || size >= U32_MAX;
    const offZ = forceZip64 || offset >= U32_MAX;
    const extra = sizeZ ? zip64Extra([size, size]) : Buffer.alloc(0);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(sizeZ ? 45 : 20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names, no data descriptor (bit 3 clear)
    lh.writeUInt16LE(0, 8); // STORE
    lh.writeUInt16LE(dos.time, 10);
    lh.writeUInt16LE(dos.date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(sizeZ ? U32_MAX : size, 18);
    lh.writeUInt32LE(sizeZ ? U32_MAX : size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(extra.length, 28);
    await writeAll(Buffer.concat([lh, nameBuf, extra]));
    await dataStream();
    entries.push({ nameBuf, size, crc, offset, sizeZ, offZ });
    return offset;
  }

  return {
    async addBuffer(name, buf) {
      guard();
      try {
        checkAborted(signal);
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = crc32(buf) >>> 0;
        const md5 = createHash('md5').update(buf).digest('hex');
        await writeMember(nameBuf, buf.length, crc, () => writeAll(buf));
        return { size: buf.length, crc32: crc, md5 };
      } catch (err) {
        await abort();
        throw err;
      }
    },

    async addFile(name, srcPath) {
      guard();
      try {
        checkAborted(signal);
        const first = await hashFile(srcPath, signal);
        if (afterFirstPass) await afterFirstPass(srcPath);
        const nameBuf = Buffer.from(name, 'utf8');
        await writeMember(nameBuf, first.size, first.crc32, async () => {
          let n = 0;
          let crc = 0;
          try {
            for await (const chunk of createReadStream(srcPath, { highWaterMark: CHUNK })) {
              checkAborted(signal);
              n += chunk.length;
              crc = crc32(chunk, crc);
              await writeAll(chunk);
            }
          } catch (err) {
            if (err instanceof ExportError) throw err;
            throw new ExportError('read_error', `cannot read media: ${err.code ?? 'IO error'}`);
          }
          if (n !== first.size || (crc >>> 0) !== first.crc32) {
            throw new ExportError('read_error', 'media changed during export');
          }
        });
        return { size: first.size, crc32: first.crc32, md5: first.md5 };
      } catch (err) {
        await abort();
        throw err;
      }
    },

    async finish() {
      guard();
      try {
        const cdStart = pos;
        for (const e of entries) {
          const vals = [];
          if (e.sizeZ) vals.push(e.size, e.size);
          if (e.offZ) vals.push(e.offset);
          const extra = vals.length ? zip64Extra(vals) : Buffer.alloc(0);
          const ch = Buffer.alloc(46);
          const ver = e.sizeZ || e.offZ ? 45 : 20;
          ch.writeUInt32LE(0x02014b50, 0);
          ch.writeUInt16LE(ver, 4);
          ch.writeUInt16LE(ver, 6);
          ch.writeUInt16LE(0x0800, 8);
          ch.writeUInt16LE(0, 10);
          ch.writeUInt16LE(dos.time, 12);
          ch.writeUInt16LE(dos.date, 14);
          ch.writeUInt32LE(e.crc, 16);
          ch.writeUInt32LE(e.sizeZ ? U32_MAX : e.size, 20);
          ch.writeUInt32LE(e.sizeZ ? U32_MAX : e.size, 24);
          ch.writeUInt16LE(e.nameBuf.length, 28);
          ch.writeUInt16LE(extra.length, 30);
          ch.writeUInt16LE(0, 32); // comment length
          ch.writeUInt16LE(0, 34); // disk start
          ch.writeUInt16LE(0, 36); // internal attributes
          ch.writeUInt32LE(0, 38); // external attributes
          ch.writeUInt32LE(e.offZ ? U32_MAX : e.offset, 42);
          await writeAll(Buffer.concat([ch, e.nameBuf, extra]));
        }
        const cdSize = pos - cdStart;
        const n = entries.length;
        const needZ64 = forceZip64 || entries.some((e) => e.sizeZ || e.offZ)
          || n >= U16_MAX || cdStart >= U32_MAX || cdSize >= U32_MAX;
        if (needZ64) {
          const z64At = pos;
          const rec = Buffer.alloc(56);
          rec.writeUInt32LE(0x06064b50, 0);
          rec.writeBigUInt64LE(44n, 4);
          rec.writeUInt16LE(45, 12);
          rec.writeUInt16LE(45, 14);
          rec.writeBigUInt64LE(BigInt(n), 24);
          rec.writeBigUInt64LE(BigInt(n), 32);
          rec.writeBigUInt64LE(BigInt(cdSize), 40);
          rec.writeBigUInt64LE(BigInt(cdStart), 48);
          await writeAll(rec);
          const loc = Buffer.alloc(20);
          loc.writeUInt32LE(0x07064b50, 0);
          loc.writeUInt32LE(0, 4);
          loc.writeBigUInt64LE(BigInt(z64At), 8);
          loc.writeUInt32LE(1, 16);
          await writeAll(loc);
        }
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(needZ64 ? U16_MAX : n, 8);
        eocd.writeUInt16LE(needZ64 ? U16_MAX : n, 10);
        eocd.writeUInt32LE(needZ64 ? U32_MAX : cdSize, 12);
        eocd.writeUInt32LE(needZ64 ? U32_MAX : cdStart, 16);
        eocd.writeUInt16LE(0, 20);
        await writeAll(eocd);
        await fh.sync();
        await fh.close();
        await rename(partial, outPath);
        done = true;
        return { bytes: pos, entries: n };
      } catch (err) {
        await abort();
        throw err;
      }
    },

    abort,
  };
}
