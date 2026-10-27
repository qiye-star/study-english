import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCandidates } from './enjoy-db.mjs';
import { makeLibrary, hex, sentences } from './fixtures/make-fixture.mjs';

const bytes = (n) => Buffer.alloc(n, 0x61);

function setup(videos, opts = {}) {
  const lib = mkdtempSync(path.join(tmpdir(), 'enjoy-db-test-'));
  const made = makeLibrary(lib, { videos, ...opts });
  return { lib, ...made };
}

function byMd5(list) {
  return Object.fromEntries(list.map((c) => [c.md5, c]));
}

test('each R-E5 reason code is produced by its own record, and the rest are ok', () => {
  const { mediaDir, dbPath } = setup([
    // ok: compressed mp4 with timeline
    { id: 'a', md5: hex(1), name: 'Ok one', language: 'en-US', transcription: {}, files: { [`${hex(1)}.compressed.mp4`]: bytes(10) } },
    // not_transcribed: no row
    { id: 'b', md5: hex(4), name: 'No row', transcription: null, files: { [`${hex(4)}.compressed.mp4`]: bytes(1) } },
    // not_transcribed: pending
    { id: 'c', md5: hex(5), name: 'Pending', transcription: { state: 'pending' }, files: { [`${hex(5)}.compressed.mp4`]: bytes(1) } },
    // no_timeline
    { id: 'd', md5: hex(6), name: 'Plain', transcription: { result: { text: 'plain only' } }, files: { [`${hex(6)}.compressed.mp4`]: bytes(1) } },
    // empty_subtitle
    { id: 'e', md5: hex(7), name: 'Blank', transcription: { result: { timeline: [{ type: 'sentence', text: ' ', startTime: 0, endTime: 1 }] } }, files: { [`${hex(7)}.compressed.mp4`]: bytes(1) } },
    // subtitle_too_large (cue count)
    { id: 'f', md5: hex(8), name: 'Many', transcription: { result: { timeline: sentences(20001) } }, files: { [`${hex(8)}.compressed.mp4`]: bytes(1) } },
    // subtitle_too_large (bytes)
    {
      id: 'g', md5: hex(9), name: 'Long', files: { [`${hex(9)}.compressed.mp4`]: bytes(1) },
      transcription: { result: { timeline: [
        { type: 'sentence', text: 'a'.repeat(1.1 * 1024 * 1024), startTime: 0, endTime: 1 },
        { type: 'sentence', text: 'b'.repeat(1.1 * 1024 * 1024), startTime: 1, endTime: 2 },
      ] } },
    },
    // media_missing
    { id: 'h', md5: hex(10), name: 'No media', transcription: {} },
    // unsupported_format (original only, avi)
    { id: 'i', md5: hex(11), name: 'Avi', metadata: { duration: 3, extname: '.avi' }, transcription: {}, files: { [`${hex(11)}.avi`]: bytes(5) } },
    // bad_record: invalid metadata JSON
    { id: 'j', md5: hex(13), name: 'Bad meta', metadata: '{not json', transcription: {}, files: { [`${hex(13)}.compressed.mp4`]: bytes(1) } },
    // bad_record: invalid result JSON
    { id: 'k', md5: hex(14), name: 'Bad result', transcription: { result: '{' }, files: { [`${hex(14)}.compressed.mp4`]: bytes(1) } },
    // bad_record: md5 not 32 lowercase hex
    { id: 'l', md5: 'NOT-A-MD5', name: 'Bad md5', transcription: {}, files: {} },
  ], {});
  const list = loadCandidates({ dbPath, mediaDir });
  const m = byMd5(list);
  assert.equal(list.length, 12);
  assert.equal(m[hex(1)].status, 'ok');
  assert.equal(m[hex(4)].reason, 'not_transcribed');
  assert.equal(m[hex(5)].reason, 'not_transcribed');
  assert.equal(m[hex(6)].reason, 'no_timeline');
  assert.equal(m[hex(7)].reason, 'empty_subtitle');
  assert.equal(m[hex(8)].reason, 'subtitle_too_large');
  assert.equal(m[hex(9)].reason, 'subtitle_too_large');
  assert.equal(m[hex(10)].reason, 'media_missing');
  assert.equal(m[hex(11)].reason, 'unsupported_format');
  assert.equal(m[hex(13)].reason, 'bad_record');
  assert.equal(m[hex(14)].reason, 'bad_record');
  assert.equal(list.find((c) => c.title === 'Bad md5').reason, 'bad_record');
  for (const c of list) {
    assert.equal(c.status, c.reason ? 'skip' : 'ok', c.title);
  }
});

test('the compressed copy is preferred over the original', () => {
  const { mediaDir, dbPath } = setup([
    {
      id: 'a', md5: hex(2), name: 'Both', metadata: { duration: 5, extname: '.mov' }, transcription: {},
      files: { [`${hex(2)}.compressed.mp4`]: bytes(7), [`${hex(2)}.mov`]: bytes(99) },
    },
  ]);
  const [c] = loadCandidates({ dbPath, mediaDir });
  assert.equal(c.status, 'ok');
  assert.equal(c.media.kind, 'compressed');
  assert.equal(c.media.ext, 'mp4');
  assert.equal(c.media.bytes, 7);
});

test('an original .mov is used when there is no compressed copy', () => {
  const { mediaDir, dbPath } = setup([
    { id: 'a', md5: hex(3), name: 'Mov', metadata: { duration: 5, extname: '.MOV' }, transcription: {}, files: { [`${hex(3)}.MOV`]: bytes(9) } },
  ]);
  const [c] = loadCandidates({ dbPath, mediaDir });
  assert.equal(c.status, 'ok');
  assert.equal(c.media.kind, 'original');
  assert.equal(c.media.ext, 'mov');
});

test('title, language and duration follow R-E6', () => {
  const { mediaDir, dbPath } = setup([
    { id: 'a', md5: hex(15), name: '  Hi\u0007  there\n\n', language: null, metadata: { duration: 12.3456, extname: '.mp4' }, transcription: { language: 'zh-CN' }, files: { [`${hex(15)}.compressed.mp4`]: bytes(1) } },
    { id: 'b', md5: hex(16), name: ' \u0001 ', metadata: { extname: '.mp4' }, transcription: {}, files: { [`${hex(16)}.compressed.mp4`]: bytes(1) } },
    { id: 'c', md5: hex(17), name: 'x'.repeat(300), metadata: { duration: 1, extname: '.mp4' }, transcription: {}, files: { [`${hex(17)}.compressed.mp4`]: bytes(1) } },
  ]);
  const m = byMd5(loadCandidates({ dbPath, mediaDir }));
  assert.equal(m[hex(15)].title, 'Hi there');
  assert.equal(m[hex(15)].language, 'zh-CN');
  assert.equal(m[hex(15)].durationMs, 12346);
  assert.equal(m[hex(16)].title, 'Enjoy video');
  assert.equal(m[hex(16)].durationMs, null);
  assert.equal(m[hex(17)].title.length, 200);
});

test('no local absolute path from metadata or source appears in any returned field', () => {
  const { mediaDir, dbPath } = setup([
    {
      id: 'a', md5: hex(1), name: 'Private', source: '/Users/alice/Movies/private.mp4',
      metadata: { duration: 5, extname: '.mp4', format: { filename: '/Users/alice/Movies/private.mp4' } },
      transcription: {}, files: { [`${hex(1)}.compressed.mp4`]: bytes(1) },
    },
  ]);
  const list = loadCandidates({ dbPath, mediaDir });
  const dump = JSON.stringify(list, (k, v) => (k === 'mediaPath' ? undefined : v));
  assert.equal(dump.includes('/Users/alice'), false);
  assert.equal(dump.includes('private.mp4'), false);
});

test('the database is read from a temporary copy that is removed afterwards, and the original is untouched', () => {
  const { mediaDir, dbPath } = setup([
    { id: 'a', md5: hex(1), name: 'T', transcription: {}, files: { [`${hex(1)}.compressed.mp4`]: bytes(1) } },
  ]);
  const before = statSync(dbPath).mtimeMs;
  const countCopies = () => readdirSync(tmpdir()).filter((n) => n.startsWith('enjoy-export-db-')).length;
  const n0 = countCopies();
  const list = loadCandidates({ dbPath, mediaDir });
  assert.equal(list.length, 1);
  assert.equal(countCopies(), n0);
  assert.equal(statSync(dbPath).mtimeMs, before);
});
