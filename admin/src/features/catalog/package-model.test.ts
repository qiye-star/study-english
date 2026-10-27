import { describe, expect, it } from "vitest";
import { buildZip, blobOf, type TestEntry } from "../../lib/test-zip";
import { md5Hex } from "../../lib/md5";
import { categorize, parsePackage, type CheckMatch, type PackageItem } from "./package-model";

const enc = (s: string) => new TextEncoder().encode(s);
const MD5A = "0123456789abcdef0123456789abcdef";
const MD5B = "fedcba9876543210fedcba9876543210";
const MIB = 1024 * 1024;

interface Spec {
  md5: string;
  title?: string;
  language?: string | null;
  media?: Uint8Array;
  ext?: string;
  srt?: string;
  mediaCompressed?: boolean;
  manifest?: (item: Record<string, unknown>) => void;
  meta?: (meta: Record<string, unknown>) => void;
  omit?: string[];
  extraMedia?: boolean;
}

function specEntries(s: Spec): TestEntry[] {
  const media = s.media ?? enc("fake media bytes");
  const srt = s.srt ?? "1\n00:00:00,000 --> 00:00:01,000\nhello\n\n2\n00:00:01,000 --> 00:00:02,000\nworld\n\n3\n00:00:02,000 --> 00:00:03,000\n!\n";
  const ext = s.ext ?? "mp4";
  const title = s.title ?? "Talk";
  const language = s.language === undefined ? "en-US" : s.language;
  const mediaMd5 = md5Hex(media);
  const srtMd5 = md5Hex(enc(srt));
  const item: Record<string, unknown> = {
    source_md5: s.md5, title, language, duration_ms: 61000, media_bytes: media.length, media_md5: mediaMd5, subtitle_cues: 3,
  };
  s.manifest?.(item);
  const meta: Record<string, unknown> = {
    version: 1, source_md5: s.md5, title, language, duration_ms: 61000,
    media: { name: `media.${ext}`, bytes: media.length, md5: mediaMd5, compressed_by_enjoy: true },
    subtitle: { name: "subtitle.srt", bytes: enc(srt).length, md5: srtMd5, cues: 3, from: "enjoy-transcription", engine: null, model: null },
  };
  s.meta?.(meta);
  const dir = `items/${s.md5}`;
  const all: TestEntry[] = [
    { name: `${dir}/meta.json`, data: JSON.stringify(meta) },
    { name: `${dir}/subtitle.srt`, data: srt },
    { name: `${dir}/media.${ext}`, data: media, method: s.mediaCompressed ? 8 : 0 },
  ];
  if (s.extraMedia) all.push({ name: `${dir}/media.mkv`, data: enc("second") });
  return all.filter((e) => !(s.omit ?? []).some((o) => e.name.endsWith(o)));
}

function manifestEntry(items: Record<string, unknown>[], extra: Record<string, unknown> = {}): TestEntry {
  return {
    name: "manifest.json",
    data: JSON.stringify({
      format: "enjoy-video-export", version: 1, exported_at: "2026-10-27T08:00:00Z", generator: "enjoy-export/1",
      items, skipped: { not_transcribed: 2 }, ...extra,
    }),
  };
}

function manifestRow(s: Spec): Record<string, unknown> {
  const media = s.media ?? enc("fake media bytes");
  const row: Record<string, unknown> = {
    source_md5: s.md5, title: s.title ?? "Talk", language: s.language === undefined ? "en-US" : s.language, duration_ms: 61000,
    media_bytes: media.length, media_md5: md5Hex(media), subtitle_cues: 3,
  };
  s.manifest?.(row);
  return row;
}

async function pkg(specs: Spec[], opts: { manifest?: Record<string, unknown>; entries?: TestEntry[] } = {}): Promise<Blob> {
  const rows = specs.map(manifestRow);
  const entries = specs.flatMap(specEntries);
  return blobOf(await buildZip([manifestEntry(rows, opts.manifest), ...(opts.entries ?? entries)]));
}

const LIMIT = { maxUploadMb: 500 };

describe("parsePackage: manifest level", () => {
  it("accepts a well-formed v1 package and keeps manifest order", async () => {
    const blob = await pkg([{ md5: MD5A, title: "First" }, { md5: MD5B, title: "Second", language: null }]);
    const model = await parsePackage(blob, LIMIT);
    expect(model.items.map((i) => i.sourceMd5)).toEqual([MD5A, MD5B]);
    expect(model.items.map((i) => i.skip)).toEqual([null, null]);
    expect(model.exportedAt).toBe("2026-10-27T08:00:00Z");
    expect(model.skipped).toEqual({ not_transcribed: 2 });
  });

  it("rejects bytes that are not a package with not_package", async () => {
    await expect(parsePackage(blobOf(enc("nope")), LIMIT)).rejects.toMatchObject({ reason: "not_package" });
    const noManifest = await buildZip([{ name: `items/${MD5A}/meta.json`, data: "{}" }]);
    await expect(parsePackage(blobOf(noManifest), LIMIT)).rejects.toMatchObject({ reason: "not_package" });
  });

  it("refuses a newer version and wrong format / version types", async () => {
    const v2 = await buildZip([{ name: "manifest.json", data: JSON.stringify({ format: "enjoy-video-export", version: 2, items: [], skipped: {} }) }]);
    await expect(parsePackage(blobOf(v2), LIMIT)).rejects.toMatchObject({ reason: "newer_version" });
    const wrongFormat = await buildZip([{ name: "manifest.json", data: JSON.stringify({ format: "other", version: 1, items: [], skipped: {} }) }]);
    await expect(parsePackage(blobOf(wrongFormat), LIMIT)).rejects.toMatchObject({ reason: "not_package" });
    const noVersion = await buildZip([{ name: "manifest.json", data: JSON.stringify({ format: "enjoy-video-export", items: [], skipped: {} }) }]);
    await expect(parsePackage(blobOf(noVersion), LIMIT)).rejects.toMatchObject({ reason: "not_package" });
    const stringVersion = await buildZip([{ name: "manifest.json", data: JSON.stringify({ format: "enjoy-video-export", version: "1", items: [], skipped: {} }) }]);
    await expect(parsePackage(blobOf(stringVersion), LIMIT)).rejects.toMatchObject({ reason: "not_package" });
  });

  it("rejects a manifest with more than 1000 items", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ source_md5: i.toString(16).padStart(32, "0") }));
    const blob = blobOf(await buildZip([manifestEntry(rows)]));
    await expect(parsePackage(blob, LIMIT)).rejects.toMatchObject({ reason: "bad_manifest" });
  });

  it("rejects a manifest bigger than 1 MiB", async () => {
    const pad = "x".repeat(MIB + 10);
    const blob = blobOf(await buildZip([manifestEntry([], { pad })]));
    await expect(parsePackage(blob, LIMIT)).rejects.toMatchObject({ reason: "bad_manifest" });
  });

  it("rejects duplicate source_md5 values in the manifest", async () => {
    const blob = await pkg([{ md5: MD5A }, { md5: MD5A, title: "again" }]);
    await expect(parsePackage(blob, LIMIT)).rejects.toMatchObject({ reason: "duplicate" });
  });

  it.each<[string, (r: Record<string, unknown>) => void]>([
    ["uppercase md5", (r) => (r.source_md5 = MD5A.toUpperCase())],
    ["empty title", (r) => (r.title = "   ")],
    ["title over 200 characters", (r) => (r.title = "t".repeat(201))],
    ["language over 16 characters", (r) => (r.language = "x".repeat(17))],
    ["zero duration", (r) => (r.duration_ms = 0)],
    ["negative media bytes", (r) => (r.media_bytes = -1)],
    ["media md5 not hex", (r) => (r.media_md5 = "z".repeat(32))],
    ["zero cues", (r) => (r.subtitle_cues = 0)],
    ["too many cues", (r) => (r.subtitle_cues = 20001)],
  ])("marks the one item with %s as bad_manifest", async (_name, patch) => {
    const blob = await pkg([{ md5: MD5A, manifest: patch }, { md5: MD5B, title: "ok" }]);
    const model = await parsePackage(blob, LIMIT);
    expect(model.items[0].skip).toBe("bad_manifest");
    expect(model.items[1].skip).toBeNull();
  });
});

describe("parsePackage: entries and meta", () => {
  it("marks an item whose meta disagrees with the manifest as bad_meta and keeps the others", async () => {
    const blob = await pkg([{ md5: MD5A, meta: (m) => (m.title = "Different") }, { md5: MD5B }]);
    const model = await parsePackage(blob, LIMIT);
    expect(model.items.map((i) => i.skip)).toEqual(["bad_meta", null]);
  });

  it("marks an item whose media md5 disagrees with meta as bad_meta", async () => {
    const blob = await pkg([{ md5: MD5A, meta: (m) => ((m.media as Record<string, unknown>).md5 = MD5B) }]);
    expect((await parsePackage(blob, LIMIT)).items[0].skip).toBe("bad_meta");
  });

  it("marks a missing subtitle or a missing / duplicate media entry as missing_entry", async () => {
    expect((await parsePackage(await pkg([{ md5: MD5A, omit: ["subtitle.srt"] }]), LIMIT)).items[0].skip).toBe("missing_entry");
    expect((await parsePackage(await pkg([{ md5: MD5A, omit: ["meta.json"] }]), LIMIT)).items[0].skip).toBe("missing_entry");
    expect((await parsePackage(await pkg([{ md5: MD5A, extraMedia: true }]), LIMIT)).items[0].skip).toBe("missing_entry");
    expect((await parsePackage(await pkg([{ md5: MD5A, omit: ["media.mp4"] }]), LIMIT)).items[0].skip).toBe("missing_entry");
  });

  it("marks DEFLATE media as media_compressed", async () => {
    const model = await parsePackage(await pkg([{ md5: MD5A, mediaCompressed: true }]), LIMIT);
    expect(model.items[0].skip).toBe("media_compressed");
  });

  it("marks media larger than the upload limit as too_large", async () => {
    const big = new Uint8Array(MIB + 1);
    const model = await parsePackage(await pkg([{ md5: MD5A, media: big }]), { maxUploadMb: 1 });
    expect(model.items[0].skip).toBe("too_large");
  });

  it("marks an item whose declared bytes differ from the entry as bad_meta", async () => {
    const blob = await pkg([{ md5: MD5A, meta: (m) => ((m.subtitle as Record<string, unknown>).bytes = 3) }]);
    expect((await parsePackage(blob, LIMIT)).items[0].skip).toBe("bad_meta");
  });

  it("reads DEFLATE-compressed meta and srt (only media must be STORE)", async () => {
    const s: Spec = { md5: MD5A };
    const entries = specEntries(s).map((e) => (e.name.endsWith("meta.json") || e.name.endsWith("subtitle.srt") ? { ...e, method: 8 } : e));
    const blob = blobOf(await buildZip([manifestEntry([manifestRow(s)]), ...entries]));
    const model = await parsePackage(blob, LIMIT);
    expect(model.items[0].skip).toBeNull();
  });
});

describe("parsePackage: language, title and md5 of the entries", () => {
  it("flags non-English items as nonEnglish; null and en* stay selectable", async () => {
    const blob = await pkg([
      { md5: MD5A, language: "zh-CN" },
      { md5: MD5B, language: "ja" },
    ]);
    const m = await parsePackage(blob, LIMIT);
    expect(m.items.map((i) => i.nonEnglish)).toEqual([true, true]);
    const blob2 = await pkg([{ md5: MD5A, language: "en-US" }, { md5: MD5B, language: "EN" }, { md5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", language: null }]);
    const m2 = await parsePackage(blob2, LIMIT);
    expect(m2.items.map((i) => i.nonEnglish)).toEqual([false, false, false]);
  });

  it("strips control characters from titles before showing them", async () => {
    const blob = await pkg([{ md5: MD5A, title: "Hi\u0007 there\u001b\n " }]);
    const m = await parsePackage(blob, LIMIT);
    expect(m.items[0].title).toBe("Hi there");
  });

  it("entries are read as Blob views with the declared media md5 available", async () => {
    const m = await parsePackage(await pkg([{ md5: MD5A }]), LIMIT);
    const item = m.items[0];
    expect(item.mediaMd5).toBe(md5Hex(enc("fake media bytes")));
    expect(item.media?.size).toBe(enc("fake media bytes").length);
  });
});

describe("categorize", () => {
  const base: PackageItem = {
    sourceMd5: MD5A, title: "T", language: "en-US", durationMs: 1, mediaExt: "mp4", mediaBytes: 100, mediaMd5: MD5B,
    subtitleCues: 3, subtitleMd5: MD5B, subtitleBytes: 10, media: null, subtitle: null, nonEnglish: false, skip: null,
  };
  const row = (over: Partial<CheckMatch>): CheckMatch => ({
    sourceMd5: MD5A, catalogId: "c1", title: "T", status: "ready", published: false, retired: false, segCount: 5,
    durationMs: 1, mediaMissing: false, refs: 0, uploadReceived: 0, uploadTotal: 0, ...over,
  });

  it("no match is new and creates", () => {
    const p = categorize(base, [], "skip");
    expect(p).toMatchObject({ category: "new", action: "create", importable: true });
  });

  it("only failed, canceled or retired rows still count as new (with a stale-row note for failed)", () => {
    expect(categorize(base, [row({ status: "failed" })], "skip")).toMatchObject({ category: "new", importable: true, staleFailed: true });
    expect(categorize(base, [row({ status: "canceled" })], "skip")).toMatchObject({ category: "new", staleFailed: false });
    expect(categorize(base, [row({ retired: true })], "skip")).toMatchObject({ category: "new" });
  });

  it("ready, unpublished, with sentences is exists: skipped by default, replaced in overwrite mode", () => {
    expect(categorize(base, [row({})], "skip")).toMatchObject({ category: "exists", importable: false, action: null });
    expect(categorize(base, [row({})], "overwrite")).toMatchObject({ category: "exists", importable: true, action: "replace" });
  });

  it("published items are never importable, in either mode", () => {
    for (const mode of ["skip", "overwrite"] as const) {
      expect(categorize(base, [row({ published: true })], mode)).toMatchObject({ category: "published", importable: false });
    }
  });

  it("an upload that stopped halfway is resumable when its total equals the media size", () => {
    const up = row({ status: "uploading", segCount: 0, uploadReceived: 40, uploadTotal: 100 });
    expect(categorize(base, [up], "skip")).toMatchObject({ category: "resumable", importable: true, action: "resume" });
    expect(categorize(base, [{ ...up, uploadTotal: 99 }], "skip")).toMatchObject({ category: "busy", importable: false });
  });

  it("queued, processing, a replace in progress, or ready with media missing are busy", () => {
    for (const r of [row({ status: "queued" }), row({ status: "processing" }), row({ status: "uploading", segCount: 4 }), row({ mediaMissing: true })]) {
      expect(categorize(base, [r], "overwrite")).toMatchObject({ category: "busy", importable: false });
    }
  });

  it("a local skip stays not importable whatever is on the server", () => {
    expect(categorize({ ...base, skip: "bad_meta" }, [], "overwrite")).toMatchObject({ category: "skip_local", importable: false, reason: "bad_meta" });
  });
});
