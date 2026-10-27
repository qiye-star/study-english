import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, truncateSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { makeLibrary, hex, sentences } from './fixtures/make-fixture.mjs';
import { inspectZip } from './fixtures/zip-inspect.mjs';

const CLI = new URL('../enjoy-export.mjs', import.meta.url).pathname;
const USER = '55550002';
const ENV = { ...process.env, ENJOY_EXPORT_NOW: '2026-10-27T08:00:00Z' };
delete ENV.LIBRARY_PATH;
delete ENV.SETTINGS_PATH;

function library(videos) {
  const lib = mkdtempSync(path.join(tmpdir(), 'enjoy-cli-lib-'));
  makeLibrary(lib, { user: USER, videos });
  return lib;
}

function standardLibrary() {
  return library([
    { id: 'a', md5: hex(1), name: 'Alpha', language: 'en-US', metadata: { duration: 9, extname: '.mp4' }, transcription: { result: { timeline: sentences(2) } }, files: { [`${hex(1)}.compressed.mp4`]: Buffer.alloc(2048, 0x41) } },
    { id: 'b', md5: hex(2), name: 'Beta', language: 'zh-CN', metadata: { duration: 4, extname: '.mp4' }, transcription: { result: { timeline: sentences(1, { text: '你好' }) } }, files: { [`${hex(2)}.mp4`]: Buffer.alloc(512, 0x42) } },
    { id: 'c', md5: hex(3), name: 'Skipped one', transcription: { state: 'pending' } },
    { id: 'd', md5: hex(4), name: 'Skipped two', transcription: {} },
  ]);
}

function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { env: { ...ENV, ...extraEnv }, encoding: 'utf8', input: '' });
}

test('default run exports every exportable item into one zip and reports the skips', () => {
  const lib = standardLibrary();
  const out = path.join(lib, 'pkg.zip');
  const r = run(['--library', lib, '--user', USER, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const z = inspectZip(out);
  const manifest = JSON.parse(z.byName('manifest.json').data.toString('utf8'));
  assert.equal(manifest.items.length, 2);
  assert.deepEqual(manifest.skipped, { not_transcribed: 1, media_missing: 1 });
  // the terminal output may show titles, but never the md5 or the user folder name
  assert.equal(`${r.stdout}${r.stderr}`.includes(hex(1)), false);
  assert.equal(existsSync(`${out}.partial`), false);
});

test('--list prints the list and writes nothing', () => {
  const lib = standardLibrary();
  const out = path.join(lib, 'list.zip');
  const r = run(['--library', lib, '--user', USER, '--out', out, '--list']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Alpha/);
  assert.equal(existsSync(out), false);
});

test('--pick without an interactive terminal is a usage error', () => {
  const lib = standardLibrary();
  const out = path.join(lib, 'pick.zip');
  const r = run(['--library', lib, '--user', USER, '--out', out, '--pick']);
  assert.equal(r.status, 2);
  assert.equal(existsSync(out), false);
});

test('an existing target needs --force', () => {
  const lib = standardLibrary();
  const out = path.join(lib, 'exists.zip');
  writeFileSync(out, 'old');
  const refuse = run(['--library', lib, '--user', USER, '--out', out]);
  assert.equal(refuse.status, 2);
  assert.equal(readFileSync(out, 'utf8'), 'old');
  const forced = run(['--library', lib, '--user', USER, '--out', out, '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(inspectZip(out).entries.length > 0, true);
});

test('nothing exportable -> exit 3 and no file', () => {
  const lib = library([{ id: 'x', md5: hex(9), name: 'Only skipped', transcription: {} }]);
  const out = path.join(lib, 'none.zip');
  const r = run(['--library', lib, '--user', USER, '--out', out]);
  assert.equal(r.status, 3);
  assert.equal(existsSync(out), false);
});

test('several user folders without --user -> exit 2 and the names are listed', () => {
  const lib = standardLibrary();
  makeLibrary(lib, { user: '66660003', videos: [] });
  const r = run(['--library', lib, '--out', path.join(lib, 'x.zip')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(USER));
  assert.match(r.stderr, /66660003/);
});

test('a SIGINT during the media write removes the partial file and the output, exit 130', async () => {
  const lib = library([
    { id: 'big', md5: hex(7), name: 'Big', transcription: { result: { timeline: sentences(2) } }, files: { [`${hex(7)}.compressed.mp4`]: Buffer.alloc(1) } },
  ]);
  const media = path.join(lib, USER, 'videos', `${hex(7)}.compressed.mp4`);
  truncateSync(media, 512 * 1024 * 1024); // sparse: fast to create, slow enough to hash
  const out = path.join(lib, 'interrupt.zip');
  const child = spawn(process.execPath, [CLI, '--library', lib, '--user', USER, '--out', out], { env: ENV });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const exit = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const partial = `${out}.partial`;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (existsSync(partial) && statSync(partial).size > 1024 * 1024) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(existsSync(partial), true, 'writer should have started');
  child.kill('SIGINT');
  const { code } = await exit;
  assert.equal(code, 130, stderr);
  assert.equal(existsSync(partial), false);
  assert.equal(existsSync(out), false);
  assert.equal(readdirSync(lib).includes(USER), true);
});
