import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { candidateLocations, findLibrary, resolveDb } from './locate.mjs';
import { makeLibrary, hex } from './fixtures/make-fixture.mjs';

const TOKEN = 'FAKE-TOKEN-do-not-print-0123';

function tmpHome() {
  return mkdtempSync(path.join(tmpdir(), 'enjoy-locate-test-'));
}

test('candidate paths on Windows use APPDATA and USERPROFILE', () => {
  const c = candidateLocations({
    platform: 'win32', home: 'C:\\Users\\bob', env: { APPDATA: 'C:\\Users\\bob\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\bob' },
  });
  assert.equal(c.settings[0].path, 'C:\\Users\\bob\\AppData\\Roaming\\Enjoy\\settings.json');
  assert.equal(c.defaults[0].path, 'C:\\Users\\bob\\Documents\\EnjoyLibrary');
});

test('candidate paths on macOS use Application Support and ~/Documents', () => {
  const c = candidateLocations({ platform: 'darwin', home: '/Users/bob', env: {} });
  assert.equal(c.settings[0].path, '/Users/bob/Library/Application Support/Enjoy/settings.json');
  assert.equal(c.defaults[0].path, '/Users/bob/Documents/EnjoyLibrary');
});

test('candidate paths on Linux honour XDG_CONFIG_HOME and XDG_DOCUMENTS_DIR', () => {
  const home = tmpHome();
  mkdirSync(path.join(home, '.config'), { recursive: true });
  writeFileSync(path.join(home, '.config', 'user-dirs.dirs'), '# comment\nXDG_DOCUMENTS_DIR="$HOME/Docs"\n');
  const c = candidateLocations({ platform: 'linux', home, env: { XDG_CONFIG_HOME: '/xdg' } });
  assert.equal(c.settings[0].path, '/xdg/Enjoy/settings.json');
  assert.equal(c.defaults[0].path, path.join(home, 'Docs', 'EnjoyLibrary'));
});

test('SETTINGS_PATH (a directory) overrides the platform settings location', () => {
  const c = candidateLocations({ platform: 'linux', home: '/home/x', env: { SETTINGS_PATH: '/custom' } });
  assert.equal(c.settings[0].path, '/custom/settings.json');
});

test('precedence: LIBRARY_PATH, then settings.json library, then the default folder', () => {
  const home = tmpHome();
  const envLib = path.join(home, 'from-env');
  const settingsLib = path.join(home, 'from-settings');
  const defLib = path.join(home, 'Documents', 'EnjoyLibrary');
  for (const d of [envLib, settingsLib, defLib]) mkdirSync(d, { recursive: true });
  const settingsDir = path.join(home, 'cfg');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({ library: settingsLib, user: { accessToken: TOKEN } }));

  const base = { platform: 'linux', home, env: { SETTINGS_PATH: settingsDir } };
  const r1 = findLibrary({ ...base, env: { ...base.env, LIBRARY_PATH: envLib } });
  assert.equal(r1.dir, envLib);
  assert.equal(r1.source, 'env');
  const r2 = findLibrary(base);
  assert.equal(r2.dir, settingsLib);
  assert.equal(r2.source, 'settings');
  // no settings file -> default
  const r3 = findLibrary({ platform: 'linux', home, env: { SETTINGS_PATH: path.join(home, 'nothing') } });
  assert.equal(r3.dir, defLib);
  assert.equal(r3.source, 'default');
});

test('the settings file token never appears in the result', () => {
  const home = tmpHome();
  const lib = path.join(home, 'lib');
  mkdirSync(lib, { recursive: true });
  const cfg = path.join(home, 'cfg');
  mkdirSync(cfg, { recursive: true });
  writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ library: lib, user: { accessToken: TOKEN, id: 20261027 } }));
  const r = findLibrary({ platform: 'linux', home, env: { SETTINGS_PATH: cfg } });
  assert.equal(JSON.stringify(r).includes(TOKEN), false);
  assert.equal(JSON.stringify(r).includes('20261027'), false);
});

test('when nothing exists, the result lists the tried locations and does not throw', () => {
  const home = tmpHome();
  const r = findLibrary({ platform: 'linux', home, env: { SETTINGS_PATH: path.join(home, 'none') } });
  assert.equal(r.dir, null);
  assert.ok(Array.isArray(r.tried) && r.tried.length >= 2);
});

test('resolveDb: one user folder is picked; several need --user and list the folder names', () => {
  const lib = mkdtempSync(path.join(tmpdir(), 'enjoy-lib-test-'));
  makeLibrary(lib, { user: '11111111', videos: [] });
  const one = resolveDb({ library: lib });
  assert.equal(path.basename(one.userDir), '11111111');
  assert.equal(one.mediaDir, path.join(one.userDir, 'videos'));
  makeLibrary(lib, { user: '22222222', videos: [] });
  assert.throws(
    () => resolveDb({ library: lib }),
    (err) => err.code === 'usage' && err.message.includes('11111111') && err.message.includes('22222222'),
  );
  const picked = resolveDb({ library: lib, user: '22222222' });
  assert.equal(path.basename(picked.userDir), '22222222');
});

test('resolveDb: --dev reads the dev database; --db wins and its folder holds videos/', () => {
  const lib = mkdtempSync(path.join(tmpdir(), 'enjoy-lib-dev-'));
  makeLibrary(lib, { user: '33333333', dev: true, videos: [] });
  const r = resolveDb({ library: lib, user: '33333333', dev: true });
  assert.match(r.dbPath, /enjoy_database_dev\.sqlite$/);
  const direct = resolveDb({ db: r.dbPath });
  assert.equal(direct.mediaDir, path.join(path.dirname(r.dbPath), 'videos'));
});

test('resolveDb: no database is a usage error', () => {
  const lib = mkdtempSync(path.join(tmpdir(), 'enjoy-lib-empty-'));
  assert.throws(() => resolveDb({ library: lib }), (err) => err.code === 'usage');
  assert.equal(typeof hex, 'function');
});
