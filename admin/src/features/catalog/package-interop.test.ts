/**
 * A6 互通测试(占位,直到导出脚本的黄金样例合入):这里不读 fixtures/,而是按计划 R-P1–R-P3 的
 * 包格式规格**逐键**手写 manifest 与 meta 的 JSON,用 STORE 拼成 zip,再走导入侧的读取 → 校验 → 预览 → md5。
 * 合并后真正的黄金样例(`fixtures/enjoy-export-v1.zip`,由导出脚本生成)互通要另外验证。
 */
import { describe, expect, it } from "vitest";
import { md5Blob, md5Hex } from "../../lib/md5";
import { entryBlob } from "../../lib/zip-reader";
import { buildZip, blobOf } from "../../lib/test-zip";
import { categorize, defaultSelected, parsePackage } from "./package-model";

const enc = (s: string) => new TextEncoder().encode(s);
const MD5_1 = "0123456789abcdef0123456789abcdef";
const MD5_2 = "fedcba9876543210fedcba9876543210";
const MEDIA_1 = enc("spec-literal media one ........");
const MEDIA_2 = enc("spec-literal media two ........");
const SRT_1 = "1\n00:00:00,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:02,000 --> 00:00:04,500\nSecond line.\n";
const SRT_2 = "1\n00:00:00,000 --> 00:00:03,000\nBonjour.\n";

function manifestJson(): string {
  return JSON.stringify({
    format: "enjoy-video-export",
    version: 1,
    exported_at: "2026-10-27T08:00:00Z",
    generator: "enjoy-export/1",
    items: [
      {
        source_md5: MD5_1,
        title: "Greetings",
        language: "en-US",
        duration_ms: 4500,
        media_bytes: MEDIA_1.length,
        media_md5: md5Hex(MEDIA_1),
        subtitle_cues: 2,
      },
      {
        source_md5: MD5_2,
        title: "Bonjour",
        language: "fr-FR",
        duration_ms: null,
        media_bytes: MEDIA_2.length,
        media_md5: md5Hex(MEDIA_2),
        subtitle_cues: 1,
      },
    ],
    skipped: { not_transcribed: 2, media_missing: 1 },
  });
}

function metaJson(md5: string, title: string, language: string | null, duration: number | null, media: Uint8Array, mediaName: string, srt: string): string {
  return JSON.stringify({
    version: 1,
    source_md5: md5,
    title,
    language,
    duration_ms: duration,
    media: { name: mediaName, bytes: media.length, md5: md5Hex(media), compressed_by_enjoy: true },
    subtitle: {
      name: "subtitle.srt",
      bytes: enc(srt).length,
      md5: md5Hex(enc(srt)),
      cues: srt.split("\n\n").filter((b) => b.trim()).length,
      from: "enjoy-transcription",
      engine: "whisper",
      model: "base",
    },
  });
}

async function specZip(): Promise<Blob> {
  return blobOf(await buildZip([
    { name: "manifest.json", data: manifestJson() },
    { name: `items/${MD5_1}/meta.json`, data: metaJson(MD5_1, "Greetings", "en-US", 4500, MEDIA_1, "media.mp4", SRT_1) },
    { name: `items/${MD5_1}/subtitle.srt`, data: SRT_1 },
    { name: `items/${MD5_1}/media.mp4`, data: MEDIA_1 },
    { name: `items/${MD5_2}/meta.json`, data: metaJson(MD5_2, "Bonjour", "fr-FR", null, MEDIA_2, "media.webm", SRT_2) },
    { name: `items/${MD5_2}/subtitle.srt`, data: SRT_2 },
    { name: `items/${MD5_2}/media.webm`, data: MEDIA_2 },
  ]));
}

describe("interop with the spec's v1 package (hand-written, not the golden zip)", () => {
  it("parses, validates and previews both items; the French one is unchecked by default", async () => {
    const model = await parsePackage(await specZip(), { maxUploadMb: 500 });
    expect(model.items.map((i) => i.skip)).toEqual([null, null]);
    expect(model.exportedAt).toBe("2026-10-27T08:00:00Z");
    expect(model.skipped).toEqual({ not_transcribed: 2, media_missing: 1 });
    expect(model.items.map((i) => i.nonEnglish)).toEqual([false, true]);
    expect(model.items.map((i) => i.title)).toEqual(["Greetings", "Bonjour"]);

    const rows = model.items.map((it) => categorize(it, [], "skip"));
    expect(rows.map((r) => r.category)).toEqual(["new", "new"]);
    expect(rows.map((r) => defaultSelected(r))).toEqual([true, false]);
  });

  it("the declared media and subtitle md5 match the actual bytes", async () => {
    const zip = await specZip();
    const model = await parsePackage(zip, { maxUploadMb: 500 });
    const first = model.items[0];
    expect(await md5Blob(entryBlob(zip, first.media as NonNullable<typeof first.media>))).toBe(first.mediaMd5);
    expect(first.mediaMd5).toBe(md5Hex(MEDIA_1));
    expect(first.subtitleMd5).toBe(md5Hex(enc(SRT_1)));
  });
});
