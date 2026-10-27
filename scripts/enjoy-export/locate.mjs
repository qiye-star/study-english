// Locate the Enjoy library folder and the user database (plan R-E2, R-E3).
// Only the `library` key of settings.json is read; the other keys (login info) are never kept.
// Platform paths are NOT verified on real installs (see scripts/CLAUDE.md, plan unverified list).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ExportError } from './errors.mjs';
import { DB_NAME, DB_NAME_DEV } from './constants.mjs';

const LIB_DIR_NAME = 'EnjoyLibrary';

function pathFor(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function linuxDocumentsDir(home) {
  try {
    const text = readFileSync(path.join(home, '.config', 'user-dirs.dirs'), 'utf8');
    const m = text.match(/^XDG_DOCUMENTS_DIR="(.*)"\s*$/m);
    if (m) return m[1].replace(/\$HOME/g, home);
  } catch { /* no user-dirs file: fall back to ~/Documents */ }
  return path.join(home, 'Documents');
}

/** Pure path computation (no existence checks). Returns labelled candidates in priority order. */
export function candidateLocations({ platform = process.platform, env = process.env, home }) {
  const P = pathFor(platform);
  let settings;
  let defaults;
  if (platform === 'win32') {
    const appData = env.APPDATA ?? P.join(home, 'AppData', 'Roaming');
    settings = P.join(appData, 'Enjoy', 'settings.json');
    defaults = P.join(env.USERPROFILE ?? home, 'Documents', LIB_DIR_NAME);
  } else if (platform === 'darwin') {
    settings = P.join(home, 'Library', 'Application Support', 'Enjoy', 'settings.json');
    defaults = P.join(home, 'Documents', LIB_DIR_NAME);
  } else {
    settings = P.join(env.XDG_CONFIG_HOME || P.join(home, '.config'), 'Enjoy', 'settings.json');
    defaults = P.join(linuxDocumentsDir(home), LIB_DIR_NAME);
  }
  const settingsList = [];
  if (env.SETTINGS_PATH) settingsList.push({ label: 'SETTINGS_PATH', path: P.join(env.SETTINGS_PATH, 'settings.json') });
  settingsList.push({ label: 'platform settings', path: settings });
  return {
    env: env.LIBRARY_PATH ? [{ label: 'LIBRARY_PATH', path: env.LIBRARY_PATH }] : [],
    settings: settingsList,
    defaults: [{ label: 'default folder', path: defaults }],
  };
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** Reads only the `library` key of an electron-settings file. Returns null on any problem. */
export function readLibrarySetting(settingsFile) {
  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf8'));
    return typeof parsed?.library === 'string' && parsed.library ? parsed.library : null;
  } catch {
    return null;
  }
}

export function findLibrary({ platform = process.platform, env = process.env, home }) {
  const c = candidateLocations({ platform, env, home });
  const tried = [];
  for (const { label, path: p } of c.env) {
    if (isDir(p)) return { dir: p, source: 'env', tried };
    tried.push(`${label}: ${p}`);
  }
  for (const { label, path: file } of c.settings) {
    const lib = readLibrarySetting(file);
    if (lib && isDir(lib)) return { dir: lib, source: 'settings', tried };
    tried.push(`${label}: ${file}${lib ? ` (library folder missing: ${lib})` : ''}`);
  }
  for (const { label, path: p } of c.defaults) {
    if (isDir(p)) return { dir: p, source: 'default', tried };
    tried.push(`${label}: ${p}`);
  }
  return { dir: null, source: null, tried };
}

/** Sub-folders of the library that hold a database file (the desktop uses one per user id). */
export function listUserDirs(library, dbName) {
  try {
    return readdirSync(library, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(library, d.name, dbName)))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Resolves the database file and the media folder next to it.
 * --db wins; otherwise --library + (--user or the single user folder).
 */
export function resolveDb({ library, user, db, dev = false }) {
  const dbName = dev ? DB_NAME_DEV : DB_NAME;
  if (db) {
    const dbPath = path.resolve(db);
    if (!existsSync(dbPath)) throw new ExportError('usage', 'the --db file does not exist');
    const userDir = path.dirname(dbPath);
    return { dbPath, userDir, mediaDir: path.join(userDir, 'videos') };
  }
  if (!library) throw new ExportError('usage', 'no library folder');
  const names = listUserDirs(library, dbName);
  let chosen;
  if (user) {
    if (!names.includes(user)) throw new ExportError('usage', `no ${dbName} under --user ${user}`);
    chosen = user;
  } else if (names.length === 0) {
    throw new ExportError('usage', `no ${dbName} found in the library folder`);
  } else if (names.length === 1) {
    chosen = names[0];
  } else {
    throw new ExportError(
      'usage',
      `several user folders found; pass --user <name>: ${names.join(', ')}`,
    );
  }
  const userDir = path.join(library, chosen);
  return { dbPath: path.join(userDir, dbName), userDir, mediaDir: path.join(userDir, 'videos') };
}
