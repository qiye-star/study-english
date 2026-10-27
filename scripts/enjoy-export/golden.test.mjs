// Golden v1 package: generated from a fake library with a fixed time and compared byte-for-byte
// with the file the admin importer reads (admin/src/features/catalog/fixtures/enjoy-export-v1.zip).
// The zip is the only thing shared between the two sides. Regenerate with UPDATE_GOLDEN=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportPackage, skippedCounts } from './export.mjs';
import { loadCandidates } from './enjoy-db.mjs';
import { makeLibrary, hex, sentences } from './fixtures/make-fixture.mjs';

const GOLDEN = new URL('../../admin/src/features/catalog/fixtures/enjoy-export-v1.zip', import.meta.url).pathname;
const NOW = new Date('2026-10-27T08:00:00Z');

// Deterministic, non-compressible-looking fake bytes (a tiny LCG); not real media.
function fakeBytes(n, seed) {
  const b = Buffer.alloc(n);
  let x = seed;
  for (let i = 0; i < n; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    b[i] = x & 0xff;
  }
  return b;
}

function buildGolden(dir) {
  const { mediaDir, dbPath } = makeLibrary(dir, {
    user: '10000001',
    videos: [
      {
        id: 'g1', md5: hex(0xa1), name: 'Golden English clip', language: 'en-US',
        metadata: { duration: 9.5, extname: '.mp4', format: { filename: '/Users/alice/Movies/golden.mp4' } },
        transcription: { engine: 'whisper', model: 'base', result: { timeline: sentences(3, { text: 'Hello golden', step: 2.5 }) } },
        files: { [`${hex(0xa1)}.compressed.mp4`]: fakeBytes(4096, 11) },
      },
      {
        id: 'g2', md5: hex(0xb2), name: '黄金样例 中文', language: 'zh-CN',
        metadata: { duration: 6, extname: '.mov' },
        transcription: { engine: 'whisper', model: 'base', result: { timeline: sentences(2, { text: '你好', step: 2 }) } },
        files: { [`${hex(0xb2)}.mov`]: fakeBytes(3072, 22) },
      },
      { id: 'g3', md5: hex(0xc3), name: 'Not transcribed', transcription: { state: 'processing' }, files: { [`${hex(0xc3)}.compressed.mp4`]: fakeBytes(64, 33) } },
      { id: 'g4', md5: hex(0xd4), name: 'No media', transcription: {} },
    ],
  });
  return { candidates: loadCandidates({ dbPath, mediaDir }) };
}

test('the golden v1 package matches the committed admin fixture byte-for-byte', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'enjoy-golden-'));
  const { candidates } = buildGolden(dir);
  const items = candidates.filter((c) => c.status === 'ok');
  assert.equal(items.length, 2);
  assert.equal(candidates.length - items.length, 2);
  const out = path.join(dir, 'golden.zip');
  await exportPackage({ items, skipped: skippedCounts(candidates), outPath: out, now: NOW });
  const bytes = readFileSync(out);
  if (process.env.UPDATE_GOLDEN === '1') {
    writeFileSync(GOLDEN, bytes);
  }
  assert.deepEqual(bytes, readFileSync(GOLDEN), 'golden file differs; if the change is intended run UPDATE_GOLDEN=1 and review the diff');
});
