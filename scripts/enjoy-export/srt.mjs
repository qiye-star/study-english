// Desktop transcription timeline -> SRT (plan R-E7). Pure functions, no I/O.
// Assumption to confirm on real data (plan Task 0.2): result.timeline is a list of sentence-level
// entries in SECONDS. Nested `timeline` arrays are ignored.

// Same limits as the server's subtitle parser (server/app/library/limits.py).
export const SUBTITLE_MAX_CUES = 20000;
export const SUBTITLE_MAX_BYTES = 2 * 1024 * 1024;

const pad = (n, w) => String(n).padStart(w, '0');

export function formatSrtTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(r, 3)}`;
}

export function timelineToSrt(timeline) {
  const dropped = { empty: 0, bad_time: 0, empty_range: 0, bad_entry: 0 };
  const cues = [];
  for (const e of Array.isArray(timeline) ? timeline : []) {
    if (!e || typeof e !== 'object') {
      dropped.bad_entry += 1;
      continue;
    }
    const text = String(e.text ?? '')
      .replace(/\r\n|\r|\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      dropped.empty += 1;
      continue;
    }
    if (!Number.isFinite(e.startTime) || !Number.isFinite(e.endTime)) {
      dropped.bad_time += 1;
      continue;
    }
    const start = Math.max(0, Math.round(e.startTime * 1000));
    const end = Math.round(e.endTime * 1000);
    if (end <= start) {
      dropped.empty_range += 1;
      continue;
    }
    cues.push({ start, end, text });
  }
  cues.sort((a, b) => a.start - b.start); // Array#sort is stable
  let srt = '';
  cues.forEach((c, i) => {
    srt += `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}\n\n`;
  });
  return { srt, cues: cues.length, bytes: Buffer.byteLength(srt, 'utf8'), dropped };
}
