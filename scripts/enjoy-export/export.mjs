// Assembles the export package (plan R-P1..R-P3, R-E8, R-E9): one zip with items/<md5>/...
// and a manifest.json written last. Also the helpers the CLI uses to print the list.
import { statfs as statfsDefault } from 'node:fs/promises';
import path from 'node:path';
import { createZipWriter } from './zip-writer.mjs';
import { ExportError } from './errors.mjs';

export const PACKAGE_FORMAT = 'enjoy-video-export';
export const PACKAGE_VERSION = 1;
export const GENERATOR = 'enjoy-export/1';
export const MAX_ITEMS = 1000; // R-P2
export const LARGE_MEDIA_BYTES = 500 * 1024 * 1024; // library_max_upload_mb default (R-E5)

export const REASON_TEXT = {
  not_transcribed: '没有完成的转写',
  no_timeline: '转写没有时间信息',
  empty_subtitle: '转写转成字幕后没有内容',
  subtitle_too_large: '字幕超过云端上限',
  media_missing: '找不到媒体文件',
  unsupported_format: '视频格式不在云端支持范围内',
  bad_record: '数据库记录无法读取',
};

const exportedAt = (now) => now.toISOString().replace(/\.\d{3}Z$/, 'Z');
const json = (obj) => Buffer.from(`${JSON.stringify(obj, null, 2)}\n`, 'utf8');

/** Counts of skip reasons (only reasons that occurred). Titles are never counted or kept. */
export function skippedCounts(candidates) {
  const out = {};
  for (const c of candidates) {
    if (c.reason) out[c.reason] = (out[c.reason] ?? 0) + 1;
  }
  return out;
}

/** "all", "1,3", "5-7", empty = cancel (null). Throws ExportError('usage') on bad input. */
export function parseSelection(text, max) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (t.toLowerCase() === 'all') return Array.from({ length: max }, (_, i) => i + 1);
  const picked = new Set();
  for (const part of t.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new ExportError('usage', `无法识别的选择: ${part}`);
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b > max || a > b) throw new ExportError('usage', `序号超出范围 1–${max}: ${part}`);
    for (let i = a; i <= b; i += 1) picked.add(i);
  }
  return [...picked].sort((x, y) => x - y);
}

export const fmtMB = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const fmtDur = (ms) => {
  if (ms === null || ms === undefined) return '--:--';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Printed to the local terminal only (titles included); never written to the package or a log file. */
export function formatListing(candidates) {
  return candidates
    .map((c, i) => {
      const n = String(i + 1).padStart(3, ' ');
      let status;
      if (c.status === 'ok') {
        status = `可导出 ${fmtMB(c.media.bytes)}`;
        if (c.media.bytes > LARGE_MEDIA_BYTES) status += '(可能超过云端单文件上限)';
      } else {
        status = `跳过:${REASON_TEXT[c.reason] ?? c.reason}`;
      }
      return `${n}  ${c.title}  ${fmtDur(c.durationMs)}  ${status}`;
    })
    .join('\n');
}

async function checkSpace(outPath, items, statfs) {
  const need = items.reduce((sum, c) => sum + c.media.bytes + Buffer.byteLength(c.srt, 'utf8') + 4096, 65536);
  const st = await statfs(path.dirname(outPath));
  const free = Number(st.bavail) * Number(st.bsize);
  if (free < need * 1.01) {
    throw new ExportError('disk_full', '目标磁盘剩余空间不足,未开始导出');
  }
}

/**
 * items: exportable candidates (status 'ok'), in the order to write.
 * skipped: { reason: count } for the manifest.
 * Throws ExportError: aborted, disk_full, too_many_items, read_error, empty.
 */
export async function exportPackage({ items, skipped, outPath, now = new Date(), signal, statfs = statfsDefault }) {
  if (items.length === 0) throw new ExportError('empty', 'nothing to export');
  if (items.length > MAX_ITEMS) {
    throw new ExportError('too_many_items', `一个包最多 ${MAX_ITEMS} 条,请用 --pick 分批导出`);
  }
  await checkSpace(outPath, items, statfs);
  const writer = await createZipWriter(outPath, { now, signal });
  try {
    const manifestItems = [];
    for (const c of items) {
      const dir = `items/${c.md5}`;
      // subtitle first, then media, then meta (meta needs the media md5, so it comes after the media)
      const srt = await writer.addBuffer(`${dir}/subtitle.srt`, Buffer.from(c.srt, 'utf8'));
      const mediaName = `media.${c.media.ext}`;
      const media = await writer.addFile(`${dir}/${mediaName}`, c.media.path);
      const meta = {
        version: PACKAGE_VERSION,
        source_md5: c.md5,
        title: c.title,
        language: c.language ?? null,
        duration_ms: c.durationMs ?? null,
        media: {
          name: mediaName,
          bytes: media.size,
          md5: media.md5,
          compressed_by_enjoy: c.media.kind === 'compressed',
        },
        subtitle: {
          name: 'subtitle.srt',
          bytes: srt.size,
          md5: srt.md5,
          cues: c.cues,
          from: 'enjoy-transcription',
          engine: c.engine ?? null,
          model: c.model ?? null,
        },
      };
      await writer.addBuffer(`${dir}/meta.json`, json(meta));
      manifestItems.push({
        source_md5: c.md5,
        title: c.title,
        language: c.language ?? null,
        duration_ms: c.durationMs ?? null,
        media_bytes: media.size,
        media_md5: media.md5,
        subtitle_cues: c.cues,
      });
    }
    await writer.addBuffer('manifest.json', json({
      format: PACKAGE_FORMAT,
      version: PACKAGE_VERSION,
      exported_at: exportedAt(now),
      generator: GENERATOR,
      items: manifestItems,
      skipped,
    }));
    const done = await writer.finish();
    return { count: items.length, bytes: done.bytes, outPath };
  } catch (err) {
    await writer.abort();
    throw err;
  }
}
