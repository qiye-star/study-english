// Test helper: builds a fake Enjoy library on disk (a SQLite database with the desktop's
// `videos` and `transcriptions` columns, plus fake media bytes). Never touches a real library.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DB_NAME, DB_NAME_DEV } from '../constants.mjs';
export { DB_NAME, DB_NAME_DEV };

// Column names follow enjoy/src/main/db/migrations (underscored, as Sequelize writes them).
const SCHEMA = `
CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  language TEXT,
  source TEXT,
  md5 TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  metadata TEXT,
  cover_url TEXT,
  recordings_count INTEGER DEFAULT 0,
  recordings_duration INTEGER DEFAULT 0,
  start_transcribing_at TEXT,
  synced_at TEXT,
  uploaded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE transcriptions (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_md5 TEXT NOT NULL,
  state TEXT NOT NULL,
  language TEXT,
  engine TEXT,
  model TEXT,
  result TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const asText = (x) => (typeof x === 'string' || x === null || x === undefined ? x ?? null : JSON.stringify(x));

// A 32-char lowercase hex md5 derived from a small integer, for readable fixtures.
export const hex = (i) => i.toString(16).padStart(2, '0').repeat(16);

export function sentences(n, { text = 'Hello there', start = 0, step = 1.5 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'sentence',
    text: `${text} ${i}`,
    startTime: start + i * step,
    endTime: start + i * step + step - 0.25,
  }));
}

/**
 * videos: [{ id, md5, name, language, source, metadata, transcription, files }]
 *   metadata: object (stored as JSON) or raw string (stored as-is, for bad_record cases)
 *   transcription: null | { state, language, engine, model, result, updatedAt }
 *     result: object (JSON) or raw string
 *   files: { 'file name in videos/': Buffer }
 */
export function makeLibrary(libDir, { user = '20261027', dev = false, videos = [] } = {}) {
  const userDir = path.join(libDir, user);
  const mediaDir = path.join(userDir, 'videos');
  mkdirSync(mediaDir, { recursive: true });
  const dbPath = path.join(userDir, dev ? DB_NAME_DEV : DB_NAME);
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  const now = '2026-10-01T00:00:00.000Z';
  const insV = db.prepare(
    `INSERT INTO videos (id, language, source, md5, name, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insT = db.prepare(
    `INSERT INTO transcriptions (id, target_id, target_type, target_md5, state, language, engine, model, result, created_at, updated_at)
     VALUES (?, ?, 'Video', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  videos.forEach((v, i) => {
    const id = v.id ?? `video-${i}`;
    insV.run(
      id,
      v.language ?? null,
      v.source ?? '/Users/alice/Movies/original.mp4',
      v.md5,
      v.name ?? `Video ${i}`,
      asText(v.metadata ?? { duration: 12.5, extname: '.mp4', format: { filename: '/Users/alice/Movies/original.mp4' } }),
      now,
      now,
    );
    if (v.transcription) {
      const t = v.transcription;
      insT.run(
        `t-${id}`,
        id,
        v.md5,
        t.state ?? 'finished',
        t.language ?? null,
        t.engine ?? 'whisper',
        t.model ?? 'base',
        asText(t.result ?? { timeline: sentences(2) }),
        now,
        t.updatedAt ?? now,
      );
    }
    for (const [name, bytes] of Object.entries(v.files ?? {})) {
      writeFileSync(path.join(mediaDir, name), bytes);
    }
  });
  db.close();
  return { userDir, dbPath, mediaDir };
}
