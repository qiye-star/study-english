// Test helper: an independent, minimal ZIP reader (central directory + ZIP64) used to
// read back what zip-writer.mjs wrote. The exporter itself does not use it.
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

const EOCD = 0x06054b50;
const Z64_EOCD = 0x06064b50;
const Z64_LOC = 0x07064b50;
const CDH = 0x02014b50;
const LFH = 0x04034b50;

export function inspectZip(pathOrBuffer) {
  const buf = Buffer.isBuffer(pathOrBuffer) ? pathOrBuffer : readFileSync(pathOrBuffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no EOCD');
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  let zip64Eocd = false;
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === Z64_LOC) {
    const z64 = Number(buf.readBigUInt64LE(eocd - 12));
    if (buf.readUInt32LE(z64) !== Z64_EOCD) throw new Error('bad zip64 EOCD');
    zip64Eocd = true;
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }
  const entries = [];
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== CDH) throw new Error(`bad central header #${k}`);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    let csize = buf.readUInt32LE(p + 20);
    let usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    let offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const extra = buf.subarray(p + 46 + nlen, p + 46 + nlen + xlen);
    let x = 0;
    while (x + 4 <= extra.length) {
      const id = extra.readUInt16LE(x);
      const sz = extra.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(extra.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(extra.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(extra.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + sz;
    }
    if (buf.readUInt32LE(offset) !== LFH) throw new Error(`bad local header for ${name}`);
    const lnlen = buf.readUInt16LE(offset + 26);
    const lxlen = buf.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + lnlen + lxlen;
    const data = buf.subarray(dataStart, dataStart + csize);
    entries.push({
      name, flags, method, time, date, crc, size: usize, csize, offset,
      data: Buffer.from(data),
      crcOk: crc32(data) === crc,
    });
    p += 46 + nlen + xlen + clen;
  }
  return {
    entries,
    zip64Eocd,
    byName: (n) => entries.find((e) => e.name === n),
  };
}
