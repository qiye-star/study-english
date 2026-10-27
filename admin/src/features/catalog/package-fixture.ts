/**
 * 测试专用:按包格式规格(R-P1–R-P3)在内存里拼一个导入包,返回 File。
 * 只被 *.test.* 引用;产品代码不 import。
 */
import { md5Hex } from "../../lib/md5";
import { buildZip, type TestEntry } from "../../lib/test-zip";

const enc = (s: string) => new TextEncoder().encode(s);

export const FIXTURE_SRT = "1\n00:00:00,000 --> 00:00:01,000\nhello\n";

export interface FixtureItem {
  md5: string;
  title?: string;
  language?: string | null;
  media?: Uint8Array;
  ext?: string;
  srt?: string;
  /** 只为测试坏包:改 meta 对象 */
  meta?: (m: Record<string, unknown>) => void;
  /** 只为测试坏包:改 manifest 的这一项 */
  manifest?: (r: Record<string, unknown>) => void;
  /** 不写某个文件(只写名字结尾匹配的) */
  omit?: string[];
}

export async function makePackageFile(items: FixtureItem[], name = "enjoy-export.zip"): Promise<File> {
  const rows: Record<string, unknown>[] = [];
  const entries: TestEntry[] = [];
  for (const it of items) {
    const media = it.media ?? enc(`media for ${it.md5}`);
    const srt = it.srt ?? FIXTURE_SRT;
    const ext = it.ext ?? "mp4";
    const title = it.title ?? `Title ${it.md5.slice(0, 4)}`;
    const language = it.language === undefined ? "en-US" : it.language;
    const mediaMd5 = md5Hex(media);
    const srtMd5 = md5Hex(enc(srt));
    const row: Record<string, unknown> = {
      source_md5: it.md5, title, language, duration_ms: 61000, media_bytes: media.length, media_md5: mediaMd5, subtitle_cues: 1,
    };
    it.manifest?.(row);
    rows.push(row);
    const meta: Record<string, unknown> = {
      version: 1, source_md5: it.md5, title, language, duration_ms: 61000,
      media: { name: `media.${ext}`, bytes: media.length, md5: mediaMd5, compressed_by_enjoy: true },
      subtitle: { name: "subtitle.srt", bytes: enc(srt).length, md5: srtMd5, cues: 1, from: "enjoy-transcription", engine: null, model: null },
    };
    it.meta?.(meta);
    const dir = `items/${it.md5}`;
    const all: TestEntry[] = [
      { name: `${dir}/meta.json`, data: JSON.stringify(meta) },
      { name: `${dir}/subtitle.srt`, data: srt },
      { name: `${dir}/media.${ext}`, data: media },
    ];
    entries.push(...all.filter((e) => !(it.omit ?? []).some((o) => e.name.endsWith(o))));
  }
  const manifest = {
    format: "enjoy-video-export", version: 1, exported_at: "2026-10-27T08:00:00Z", generator: "enjoy-export/1",
    items: rows, skipped: { not_transcribed: 2 },
  };
  const bytes = await buildZip([{ name: "manifest.json", data: JSON.stringify(manifest) }, ...entries]);
  return new File([bytes as BlobPart], name, { type: "application/zip" });
}
