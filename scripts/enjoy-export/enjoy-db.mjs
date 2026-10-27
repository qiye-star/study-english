// Reads the desktop database (a temporary copy, read-only) and classifies every video
// (plan R-E4, R-E5, R-E6). Nothing here writes to the library or to the desktop database.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { timelineToSrt, SUBTITLE_MAX_CUES, SUBTITLE_MAX_BYTES } from './srt.mjs';

const MD5_RE = /^[0-9a-f]{32}$/;
const EXT_RE = /^\.[A-Za-z0-9]{1,8}$/;
const ALLOWED_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv']); // cloud whitelist (R-P1)

// Joins the videos row with its transcription. Prefers a finished row, then the newest.
const SQL = `
SELECT v.id AS id, v.md5 AS md5, v.name AS name, v.language AS v_language,
       v.metadata AS metadata, v.created_at AS created_at,
       t.state AS t_state, t.result AS t_result, t.language AS t_language,
       t.engine AS t_engine, t.model AS t_model, t.updated_at AS t_updated_at
FROM videos v
LEFT JOIN transcriptions t
  ON t.target_type = 'Video' AND (t.target_id = v.id OR t.target_md5 = v.md5)
ORDER BY v.created_at, v.id, t.updated_at
`;

/** R-E6: control characters -> space, collapse whitespace, first 200 code points. */
export function cleanTitle(name) {
  const s = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return 'Enjoy video';
  return Array.from(s).slice(0, 200).join('');
}

const short = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

function parseJsonOrThrow(text) {
  return text === null || text === undefined ? null : JSON.parse(text);
}

function chooseTranscription(rows) {
  const withRow = rows.filter((r) => r.t_state !== null);
  if (withRow.length === 0) return null;
  const finished = withRow.filter((r) => r.t_state === 'finished');
  const pool = finished.length ? finished : withRow;
  return pool.reduce((best, r) => ((r.t_updated_at ?? '') > (best.t_updated_at ?? '') ? r : best));
}

function classify(group, mediaDir) {
  const first = group[0];
  const out = {
    md5: MD5_RE.test(first.md5) ? first.md5 : null,
    title: cleanTitle(first.name),
    language: null,
    durationMs: null,
    engine: null,
    model: null,
    status: 'skip',
    reason: null,
    srt: null,
    cues: 0,
    dropped: null,
    media: null,
  };
  const fail = (reason) => ({ ...out, reason, status: 'skip' });

  if (!out.md5) return fail('bad_record');
  let meta;
  try {
    meta = parseJsonOrThrow(first.metadata) ?? {};
  } catch {
    return fail('bad_record');
  }
  const extname = meta.extname ?? '.mp4';
  if (typeof extname !== 'string' || !EXT_RE.test(extname)) return fail('bad_record');
  if (typeof meta.duration === 'number' && Number.isFinite(meta.duration) && meta.duration > 0) {
    out.durationMs = Math.round(meta.duration * 1000);
  }

  const t = chooseTranscription(group);
  out.language = short(first.v_language, 16) ?? short(t?.t_language, 16);
  out.engine = short(t?.t_engine, 64);
  out.model = short(t?.t_model, 64);

  if (!t || t.t_state !== 'finished') return fail('not_transcribed');
  let result;
  try {
    result = parseJsonOrThrow(t.t_result);
  } catch {
    return fail('bad_record');
  }
  const timeline = result?.timeline;
  if (!Array.isArray(timeline) || timeline.length === 0) return fail('no_timeline');

  const s = timelineToSrt(timeline);
  if (s.cues === 0) return fail('empty_subtitle');
  if (s.cues > SUBTITLE_MAX_CUES || s.bytes > SUBTITLE_MAX_BYTES) return fail('subtitle_too_large');

  // Prefer the compressed copy (smaller, always mp4); fall back to the original file.
  const compressed = path.join(mediaDir, `${out.md5}.compressed.mp4`);
  let media;
  if (isFile(compressed)) {
    media = { kind: 'compressed', ext: 'mp4', path: compressed, bytes: statSync(compressed).size };
  } else {
    const original = path.join(mediaDir, `${out.md5}${extname}`);
    if (!isFile(original)) return fail('media_missing');
    const ext = extname.slice(1).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return fail('unsupported_format');
    media = { kind: 'original', ext, path: original, bytes: statSync(original).size };
  }

  return { ...out, status: 'ok', reason: null, srt: s.srt, cues: s.cues, dropped: s.dropped, media };
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

/**
 * Returns one candidate per video, in database order:
 *   { md5, title, language, durationMs, engine, model, status: 'ok'|'skip', reason, srt, cues, dropped, media }
 * media: { kind: 'compressed'|'original', ext, path, bytes } when ok.
 */
export function loadCandidates({ dbPath, mediaDir }) {
  const work = mkdtempSync(path.join(tmpdir(), 'enjoy-export-db-'));
  try {
    const copy = path.join(work, 'enjoy_database.sqlite');
    copyFileSync(dbPath, copy);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${dbPath}${suffix}`)) copyFileSync(`${dbPath}${suffix}`, `${copy}${suffix}`);
    }
    const db = new DatabaseSync(copy, { readOnly: true });
    let rows;
    try {
      rows = db.prepare(SQL).all();
    } finally {
      db.close();
    }
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(r.id)) groups.set(r.id, []);
      groups.get(r.id).push(r);
    }
    return [...groups.values()].map((g) => classify(g, mediaDir));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
