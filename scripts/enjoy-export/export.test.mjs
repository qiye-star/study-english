import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { exportPackage, skippedCounts, parseSelection, formatListing } from './export.mjs';
import { loadCandidates } from './enjoy-db.mjs';
import { inspectZip } from './fixtures/zip-inspect.mjs';
import { makeLibrary, hex, sentences } from './fixtures/make-fixture.mjs';

const NOW = new Date('2026-10-27T08:00:00Z');
const md5 = (b) => createHash('md5').update(b).digest('hex');
const USER = '55550001';

function scenario() {
  const lib = mkdtempSync(path.join(tmpdir(), 'enjoy-export-lib-'));
  const { mediaDir, dbPath } = makeLibrary(lib, {
    user: USER,
    videos: [
      { id: 'a', md5: hex(1), name: 'Alpha', language: 'en-US', metadata: { duration: 61.5, extname: '.mp4', format: { filename: '/Users/alice/Movies/alpha.mp4' } }, transcription: { result: { timeline: sentences(3) }, engine: 'whisper', model: 'base' }, files: { [`${hex(1)}.compressed.mp4`]: Buffer.alloc(3000, 0x41) } },
      { id: 'b', md5: hex(2), name: 'Beta 中文', language: 'zh-CN', metadata: { duration: 5, extname: '.mov' }, transcription: { result: { timeline: sentences(2, { text: '你好' }) } }, files: { [`${hex(2)}.mov`]: Buffer.alloc(900, 0x42) } },
      { id: 'c', md5: hex(3), name: 'Pending', transcription: { state: 'pending' }, files: { [`${hex(3)}.compressed.mp4`]: Buffer.alloc(10) } },
      { id: 'd', md5: hex(4), name: 'Nomedia', transcription: {} },
    ],
  });
  const candidates = loadCandidates({ dbPath, mediaDir });
  return { lib, candidates, out: path.join(lib, 'out.zip') };
}

test('manifest and meta keys match R-P2 / R-P3 exactly; md5s match the bytes', async () => {
  const { candidates, out } = scenario();
  const items = candidates.filter((c) => c.status === 'ok');
  await exportPackage({ items, skipped: skippedCounts(candidates), outPath: out, now: NOW });
  const z = inspectZip(out);
  const manifest = JSON.parse(z.byName('manifest.json').data.toString('utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['exported_at', 'format', 'generator', 'items', 'skipped', 'version']);
  assert.equal(manifest.format, 'enjoy-video-export');
  assert.equal(manifest.version, 1);
  assert.equal(manifest.exported_at, '2026-10-27T08:00:00Z');
  assert.equal(manifest.generator, 'enjoy-export/1');
  assert.deepEqual(manifest.skipped, { not_transcribed: 1, media_missing: 1 });
  assert.equal(manifest.items.length, 2);
  for (const it of manifest.items) {
    assert.deepEqual(Object.keys(it).sort(), ['duration_ms', 'language', 'media_bytes', 'media_md5', 'source_md5', 'subtitle_cues', 'title']);
    const dir = `items/${it.source_md5}`;
    const meta = JSON.parse(z.byName(`${dir}/meta.json`).data.toString('utf8'));
    assert.deepEqual(Object.keys(meta).sort(), ['duration_ms', 'language', 'media', 'source_md5', 'subtitle', 'title', 'version']);
    assert.deepEqual(Object.keys(meta.media).sort(), ['bytes', 'compressed_by_enjoy', 'md5', 'name']);
    assert.deepEqual(Object.keys(meta.subtitle).sort(), ['bytes', 'cues', 'engine', 'from', 'md5', 'model', 'name']);
    assert.equal(meta.subtitle.from, 'enjoy-transcription');
    const media = z.byName(`${dir}/${meta.media.name}`).data;
    const srt = z.byName(`${dir}/subtitle.srt`).data;
    assert.equal(md5(media), it.media_md5);
    assert.equal(md5(media), meta.media.md5);
    assert.equal(media.length, it.media_bytes);
    assert.equal(md5(srt), meta.subtitle.md5);
    assert.equal(srt.length, meta.subtitle.bytes);
    assert.equal(meta.subtitle.cues, it.subtitle_cues);
    assert.equal(meta.title, it.title);
    assert.equal(meta.language, it.language);
    assert.equal(meta.duration_ms, it.duration_ms);
  }
  const alpha = manifest.items.find((i) => i.title === 'Alpha');
  assert.equal(alpha.duration_ms, 61500);
  assert.equal(alpha.language, 'en-US');
  assert.equal(manifest.items.find((i) => i.title === 'Beta 中文').language, 'zh-CN');
  const metaA = JSON.parse(z.byName(`items/${hex(1)}/meta.json`).data.toString('utf8'));
  assert.equal(metaA.media.compressed_by_enjoy, true);
  assert.equal(metaA.subtitle.engine, 'whisper');
  assert.equal(metaA.subtitle.model, 'base');
  assert.equal(existsSync(`${out}.partial`), false);
});

test('zip member names follow R-P1 and nothing else is written', async () => {
  const { candidates, out } = scenario();
  await exportPackage({ items: candidates.filter((c) => c.status === 'ok'), skipped: {}, outPath: out, now: NOW });
  const names = inspectZip(out).entries.map((e) => e.name);
  const re = /^(manifest\.json|items\/[0-9a-f]{32}\/(meta\.json|subtitle\.srt|media\.(mp4|m4v|mov|webm|mkv)))$/;
  for (const n of names) assert.match(n, re);
  assert.equal(names.length, 2 * 3 + 1);
});

test('no user id, local path, source path or md5 of the source appears in the zip bytes', async () => {
  const { candidates, out, lib } = scenario();
  await exportPackage({ items: candidates.filter((c) => c.status === 'ok'), skipped: {}, outPath: out, now: NOW });
  const raw = readFileSync(out);
  for (const secret of [lib, USER, '/Users/alice', 'alpha.mp4', 'FAKE-TOKEN', 'original.mp4']) {
    assert.equal(raw.includes(Buffer.from(secret, 'utf8')), false, `zip must not contain ${secret}`);
  }
});

test('free space below the estimate -> disk_full, and no file is started', async () => {
  const { candidates, out } = scenario();
  await assert.rejects(
    exportPackage({
      items: candidates.filter((c) => c.status === 'ok'),
      skipped: {},
      outPath: out,
      now: NOW,
      statfs: async () => ({ bavail: 1, bsize: 1 }),
    }),
    (err) => err.code === 'disk_full',
  );
  assert.equal(existsSync(out), false);
  assert.equal(existsSync(`${out}.partial`), false);
});

test('more than 1000 items is refused with a pointer to --pick', async () => {
  const fake = Array.from({ length: 1001 }, (_, i) => ({ md5: hex(1), title: `t${i}`, srt: '', cues: 0, media: { ext: 'mp4', path: '/x', bytes: 1 } }));
  await assert.rejects(exportPackage({ items: fake, skipped: {}, outPath: '/nonexistent/x.zip', now: NOW }), (err) => err.code === 'too_many_items');
});

test('an aborted signal leaves neither the partial file nor the target', async () => {
  const { candidates, out } = scenario();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    exportPackage({ items: candidates.filter((c) => c.status === 'ok'), skipped: {}, outPath: out, now: NOW, signal: ac.signal }),
    (err) => err.code === 'aborted',
  );
  assert.equal(existsSync(out), false);
  assert.equal(existsSync(`${out}.partial`), false);
});

test('parseSelection: all, lists, ranges, empty = cancel, bad input throws', () => {
  assert.equal(parseSelection('', 5), null);
  assert.equal(parseSelection('   ', 5), null);
  assert.deepEqual(parseSelection('all', 3), [1, 2, 3]);
  assert.deepEqual(parseSelection('1,3', 5), [1, 3]);
  assert.deepEqual(parseSelection('5-7, 2 ,2', 8), [2, 5, 6, 7]);
  assert.throws(() => parseSelection('9', 5), /1–5|1-5|范围/);
  assert.throws(() => parseSelection('x', 5));
  assert.throws(() => parseSelection('4-2', 5));
});

test('formatListing shows titles, status and skip reasons for the local terminal', () => {
  const { candidates } = scenario();
  const text = formatListing(candidates);
  assert.match(text, /Alpha/);
  assert.match(text, /没有完成的转写/);
  assert.match(text, /找不到媒体文件/);
});
