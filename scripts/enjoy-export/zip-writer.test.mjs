import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createZipWriter } from './zip-writer.mjs';
import { inspectZip } from './fixtures/zip-inspect.mjs';

const NOW = new Date('2026-10-27T08:00:00Z');
const md5 = (b) => createHash('md5').update(b).digest('hex');

function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function dosOf(d) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

test('writes STORE members that read back with the same name, size, crc and content', async () => {
  const dir = tmp('zw-basic-');
  const out = path.join(dir, 'out.zip');
  const big = path.join(dir, 'big.bin');
  const bigBytes = randomBytes(1024 * 1024);
  writeFileSync(big, bigBytes);
  const w = await createZipWriter(out, { now: NOW });
  const empty = await w.addBuffer('items/a/empty.txt', Buffer.alloc(0));
  const text = Buffer.from('字幕 subtitle\n');
  const t = await w.addBuffer('items/a/subtitle.srt', text);
  const b = await w.addFile('items/a/media.mp4', big);
  assert.equal(b.size, bigBytes.length);
  assert.equal(b.md5, md5(bigBytes));
  assert.equal(t.md5, md5(text));
  assert.equal(empty.size, 0);
  await w.finish();

  const z = inspectZip(out);
  assert.equal(z.entries.length, 3);
  for (const e of z.entries) {
    assert.equal(e.method, 0, 'STORE only');
    assert.equal(e.flags & 0x0008, 0, 'no data descriptor');
    assert.equal(e.flags & 0x0800, 0x0800, 'UTF-8 names');
    assert.equal(e.crcOk, true, `crc of ${e.name}`);
  }
  assert.deepEqual(z.byName('items/a/media.mp4').data, bigBytes);
  assert.deepEqual(z.byName('items/a/subtitle.srt').data, text);
  assert.equal(z.byName('items/a/empty.txt').size, 0);
  assert.equal(existsSync(`${out}.partial`), false);
});

test('DOS date/time equal the fixed export time (UTC)', async () => {
  const dir = tmp('zw-time-');
  const out = path.join(dir, 'out.zip');
  const w = await createZipWriter(out, { now: NOW });
  await w.addBuffer('manifest.json', Buffer.from('{}'));
  await w.finish();
  const z = inspectZip(out);
  const { time, date } = dosOf(NOW);
  assert.equal(z.entries[0].time, time);
  assert.equal(z.entries[0].date, date);
});

test('forceZip64 writes a ZIP64 EOCD and locator that the reader follows', async () => {
  const dir = tmp('zw-z64-');
  const out = path.join(dir, 'out.zip');
  const w = await createZipWriter(out, { now: NOW, forceZip64: true });
  await w.addBuffer('items/a/subtitle.srt', Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nhi\n\n'));
  await w.addBuffer('manifest.json', Buffer.from('{"format":"enjoy-video-export"}'));
  await w.finish();
  const raw = readFileSync(out);
  assert.ok(raw.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])), 'ZIP64 EOCD present');
  assert.ok(raw.includes(Buffer.from([0x50, 0x4b, 0x06, 0x07])), 'ZIP64 locator present');
  const z = inspectZip(out);
  assert.equal(z.zip64Eocd, true);
  assert.equal(z.entries.length, 2);
  assert.equal(z.byName('manifest.json').data.toString(), '{"format":"enjoy-video-export"}');
  assert.ok(z.entries.every((e) => e.crcOk));
});

test('output is byte-identical for the same input and fixed time', async () => {
  const dir = tmp('zw-det-');
  const src = path.join(dir, 'm.bin');
  writeFileSync(src, Buffer.alloc(200000, 7));
  const outs = [path.join(dir, 'a.zip'), path.join(dir, 'b.zip')];
  for (const out of outs) {
    const w = await createZipWriter(out, { now: NOW });
    await w.addFile('items/x/media.mp4', src);
    await w.addBuffer('manifest.json', Buffer.from('{}'));
    await w.finish();
  }
  assert.deepEqual(readFileSync(outs[0]), readFileSync(outs[1]));
});

test('a failure mid-way removes the .partial file and leaves no target', async () => {
  const dir = tmp('zw-fail-');
  const out = path.join(dir, 'out.zip');
  const w = await createZipWriter(out, { now: NOW });
  await w.addBuffer('manifest.json', Buffer.from('{}'));
  await assert.rejects(w.addFile('items/a/media.mp4', path.join(dir, 'missing.mp4')));
  assert.equal(existsSync(`${out}.partial`), false);
  assert.equal(existsSync(out), false);
  await assert.rejects(w.finish());
});

test('source changed between the two reads -> read_error, and nothing is published', async () => {
  const dir = tmp('zw-race-');
  const out = path.join(dir, 'out.zip');
  const src = path.join(dir, 'm.bin');
  writeFileSync(src, Buffer.alloc(1000, 1));
  const w = await createZipWriter(out, {
    now: NOW,
    afterFirstPass: async () => appendFileSync(src, 'more'),
  });
  await assert.rejects(w.addFile('items/a/media.mp4', src), (err) => err.code === 'read_error');
  assert.equal(existsSync(`${out}.partial`), false);
  assert.equal(existsSync(out), false);
});

test('a caller abort via AbortSignal removes the partial file', async () => {
  const dir = tmp('zw-sig-');
  const out = path.join(dir, 'out.zip');
  const src = path.join(dir, 'm.bin');
  writeFileSync(src, Buffer.alloc(3 * 1024 * 1024, 2));
  const ac = new AbortController();
  const w = await createZipWriter(out, { now: NOW, signal: ac.signal });
  ac.abort();
  await assert.rejects(w.addFile('items/a/media.mp4', src));
  assert.equal(existsSync(`${out}.partial`), false);
});

test('unzip -t accepts the archive when unzip is installed', async (t) => {
  let hasUnzip = true;
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { hasUnzip = false; }
  if (!hasUnzip) return t.skip('unzip not installed');
  const dir = tmp('zw-unzip-');
  const out = path.join(dir, 'out.zip');
  const w = await createZipWriter(out, { now: NOW });
  await w.addBuffer('manifest.json', Buffer.from('{}'));
  await w.addBuffer('items/a/subtitle.srt', Buffer.from('x'));
  await w.finish();
  execFileSync('unzip', ['-tq', out], { stdio: 'ignore' });
});
