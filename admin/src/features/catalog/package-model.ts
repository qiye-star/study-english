/**
 * 导入包的格式校验与预览分类(plan 2026-10-27 R-P1–R-P6、R-A3、R-A4)。纯逻辑:输入 Blob 与服务端的检查结果,输出可读的模型。
 * 包里只有 manifest / meta / srt / 媒体;md5 与标题只在内存里用,不进 URL、日志或本机存储。
 */
import { openZip, readSmallText, ZipError, type ZipEntry, type ZipReason } from "../../lib/zip-reader";
import type { CatalogStatus } from "./api";


export const PACKAGE_FORMAT = "enjoy-video-export";
export const PACKAGE_NAME_RE = /^manifest\.json$|^items\/[0-9a-f]{32}\/(meta\.json|subtitle\.srt|media\.(mp4|m4v|mov|webm|mkv)|cover\.(jpg|png))$/;
const MEDIA_RE = /^media\.(mp4|m4v|mov|webm|mkv)$/;
const MD5_RE = /^[0-9a-f]{32}$/;
const MIB = 1024 * 1024;
const MANIFEST_MAX = 1 * MIB;
const META_MAX = 64 * 1024;
const SRT_MAX = 2 * MIB;
const MAX_ITEMS = 1000;
const MAX_CUES = 20000;

export type PackageReason = ZipReason | "not_package" | "newer_version" | "bad_manifest";
export type ItemSkip = "bad_manifest" | "bad_meta" | "missing_entry" | "media_compressed" | "too_large";

export class PackageError extends Error {
  constructor(readonly reason: PackageReason) {
    super(reason);
    this.name = "PackageError";
  }
}

export interface PackageItem {
  sourceMd5: string;
  title: string;
  language: string | null;
  durationMs: number | null;
  mediaExt: string;
  mediaBytes: number;
  mediaMd5: string;
  subtitleCues: number;
  subtitleBytes: number;
  subtitleMd5: string;
  media: ZipEntry | null;
  subtitle: ZipEntry | null;
  /** 语言非空且不以 en 开头:预览里默认不勾选 */
  nonEnglish: boolean;
  skip: ItemSkip | null;
}

export interface PackageModel {
  items: PackageItem[];
  exportedAt: string | null;
  /** 导出脚本统计的跳过原因 → 条数(只有计数,没有标题) */
  skipped: Record<string, number>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/** 去控制字符、首尾空白。 */
export function cleanTitle(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
}

const isEnglish = (lang: string | null) => lang === null || /^en/i.test(lang);

interface ManifestItem {
  sourceMd5: string;
  title: string;
  language: string | null;
  durationMs: number | null;
  mediaBytes: number;
  mediaMd5: string;
  subtitleCues: number;
}

/** 逐键校验 manifest 的一项(R-P2)。不合法返回 null。 */
function parseManifestItem(raw: unknown): ManifestItem | null {
  if (!isObj(raw)) return null;
  const { source_md5, title, language, duration_ms, media_bytes, media_md5, subtitle_cues } = raw;
  if (typeof source_md5 !== "string" || !MD5_RE.test(source_md5)) return null;
  if (typeof title !== "string") return null;
  const t = cleanTitle(title);
  if (t.length < 1 || [...title].length > 200) return null;
  if (language !== null && (typeof language !== "string" || language.length > 16)) return null;
  if (duration_ms !== null && (!isInt(duration_ms) || duration_ms <= 0)) return null;
  if (!isInt(media_bytes) || media_bytes <= 0) return null;
  if (typeof media_md5 !== "string" || !MD5_RE.test(media_md5)) return null;
  if (!isInt(subtitle_cues) || subtitle_cues < 1 || subtitle_cues > MAX_CUES) return null;
  return {
    sourceMd5: source_md5,
    title,
    language: language as string | null,
    durationMs: duration_ms as number | null,
    mediaBytes: media_bytes,
    mediaMd5: media_md5,
    subtitleCues: subtitle_cues,
  };
}

/** 解析并校验整个包。整包问题抛 `PackageError`;单条问题记在该条的 `skip` 上,其余照常。 */
export async function parsePackage(blob: Blob, opts: { maxUploadMb: number }): Promise<PackageModel> {
  let entries: ZipEntry[];
  try {
    entries = await openZip(blob, { accept: (n) => PACKAGE_NAME_RE.test(n) });
  } catch (e) {
    if (e instanceof ZipError) {
      if (e.reason === "not_zip" || e.reason === "truncated" || e.reason === "malformed") throw new PackageError("not_package");
      throw new PackageError(e.reason);
    }
    throw e;
  }

  const manifestEntry = entries.find((e) => e.name === "manifest.json");
  if (!manifestEntry) throw new PackageError("not_package");
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readSmallText(blob, manifestEntry, MANIFEST_MAX));
  } catch (e) {
    if (e instanceof ZipError && e.reason === "too_large") throw new PackageError("bad_manifest");
    if (e instanceof ZipError && e.reason === "deflate_unsupported") throw new PackageError(e.reason);
    throw new PackageError("not_package");
  }
  if (!isObj(manifest) || manifest.format !== PACKAGE_FORMAT) throw new PackageError("not_package");
  const version = manifest.version;
  if (!isInt(version)) throw new PackageError("not_package");
  if (version > 1) throw new PackageError("newer_version");
  if (version !== 1) throw new PackageError("not_package");

  const rawItems = manifest.items;
  if (!Array.isArray(rawItems) || rawItems.length > MAX_ITEMS) throw new PackageError("bad_manifest");
  const skippedRaw = manifest.skipped;
  if (!isObj(skippedRaw)) throw new PackageError("bad_manifest");
  const skipped: Record<string, number> = {};
  for (const [k, v] of Object.entries(skippedRaw)) {
    if (!isInt(v) || v < 0) throw new PackageError("bad_manifest");
    skipped[k] = v;
  }

  const seen = new Set<string>();
  const items: PackageItem[] = [];
  for (const raw of rawItems) {
    const m = parseManifestItem(raw);
    if (!m) {
      const title = isObj(raw) && typeof raw.title === "string" ? cleanTitle(raw.title).slice(0, 200) : "";
      const md5 = isObj(raw) && typeof raw.source_md5 === "string" && MD5_RE.test(raw.source_md5) ? raw.source_md5 : "";
      items.push(emptyItem(md5, title, "bad_manifest"));
      continue;
    }
    if (seen.has(m.sourceMd5)) throw new PackageError("duplicate");
    seen.add(m.sourceMd5);
    items.push(await resolveItem(blob, entries, raw as Obj, m, opts.maxUploadMb));
  }
  return {
    items,
    exportedAt: typeof manifest.exported_at === "string" ? manifest.exported_at : null,
    skipped,
  };
}

function emptyItem(sourceMd5: string, title: string, skip: ItemSkip): PackageItem {
  return {
    sourceMd5, title, language: null, durationMs: null, mediaExt: "", mediaBytes: 0, mediaMd5: "", subtitleCues: 0,
    subtitleBytes: 0, subtitleMd5: "", media: null, subtitle: null, nonEnglish: false, skip,
  };
}

/** 一条:找到三个文件、逐键核对 meta 与 manifest,再看大小与压缩方式。 */
async function resolveItem(blob: Blob, entries: ZipEntry[], raw: Obj, m: ManifestItem, maxUploadMb: number): Promise<PackageItem> {
  const title = cleanTitle(m.title);
  const base = { ...emptyItem(m.sourceMd5, title, "missing_entry"), language: m.language, durationMs: m.durationMs, mediaBytes: m.mediaBytes, mediaMd5: m.mediaMd5, subtitleCues: m.subtitleCues, nonEnglish: !isEnglish(m.language) };
  const dir = `items/${m.sourceMd5}/`;
  const inDir = entries.filter((e) => e.name.startsWith(dir));
  const metaE = inDir.find((e) => e.name === `${dir}meta.json`);
  const srtE = inDir.find((e) => e.name === `${dir}subtitle.srt`);
  const mediaEs = inDir.filter((e) => MEDIA_RE.test(e.name.slice(dir.length)));
  const mediaE = mediaEs.length === 1 ? mediaEs[0] : undefined;
  if (!metaE || !srtE || !mediaE) return { ...base, skip: "missing_entry" };
  const mediaExt = mediaE.name.slice(dir.length + "media.".length);
  const withSkip = (skip: ItemSkip): PackageItem => ({ ...base, mediaExt, skip });

  if (mediaE.method !== 0) return withSkip("media_compressed");
  if (mediaE.size !== m.mediaBytes) return withSkip("bad_meta");
  if (mediaE.size > maxUploadMb * MIB) return withSkip("too_large");
  if (srtE.size > SRT_MAX) return withSkip("too_large");

  let meta: unknown;
  try {
    meta = JSON.parse(await readSmallText(blob, metaE, META_MAX));
  } catch {
    return withSkip("bad_meta");
  }
  if (!isObj(meta) || meta.version !== 1) return withSkip("bad_meta");
  const media = meta.media;
  const sub = meta.subtitle;
  if (!isObj(media) || !isObj(sub)) return withSkip("bad_meta");
  const sameTitle = meta.title === raw.title;
  const ok =
    meta.source_md5 === m.sourceMd5 &&
    sameTitle &&
    meta.language === m.language &&
    meta.duration_ms === m.durationMs &&
    media.name === mediaE.name.slice(dir.length) &&
    media.bytes === m.mediaBytes &&
    media.md5 === m.mediaMd5 &&
    typeof media.compressed_by_enjoy === "boolean" &&
    sub.name === "subtitle.srt" &&
    isInt(sub.bytes) &&
    sub.bytes === srtE.size &&
    typeof sub.md5 === "string" &&
    MD5_RE.test(sub.md5) &&
    sub.cues === m.subtitleCues &&
    typeof sub.from === "string";
  if (!ok) return withSkip("bad_meta");
  if (srtE.method !== 0 && srtE.method !== 8) return withSkip("bad_meta");

  return {
    ...base,
    mediaExt,
    subtitleBytes: srtE.size,
    subtitleMd5: sub.md5 as string,
    media: mediaE,
    subtitle: srtE,
    skip: null,
  };
}

// ---------------------------------------------------------------- 预览分类

/** 服务端 `POST /packages/check` 回包的一项(R-S3)。 */
export interface CheckMatch {
  sourceMd5: string;
  catalogId: string;
  title: string;
  status: CatalogStatus;
  published: boolean;
  retired: boolean;
  segCount: number;
  durationMs: number | null;
  mediaMissing: boolean;
  refs: number;
  uploadReceived: number;
  uploadTotal: number;
}

export type Mode = "skip" | "overwrite";
export type Category = "new" | "exists" | "published" | "resumable" | "busy" | "skip_local";
export type Action = "create" | "resume" | "replace";

export interface PlanRow {
  item: PackageItem;
  category: Category;
  action: Action | null;
  importable: boolean;
  /** 不能导入时的原因(中文文案在界面层映射) */
  reason: string | null;
  /** new 时:表格里有一条失败的旧条目 */
  staleFailed: boolean;
  match: CheckMatch | null;
}

const ACTIVE_STATUSES: CatalogStatus[] = ["uploading", "queued", "processing", "ready"];

/** 按「最新一条未退役的匹配」归类(R-A4 表格)。matches 为该 md5 的全部匹配,服务端已按新到旧排序。 */
export function categorize(item: PackageItem, matches: CheckMatch[], mode: Mode): PlanRow {
  const staleFailed = matches.some((m) => !m.retired && m.status === "failed");
  const base = { item, staleFailed };
  if (item.skip) return { ...base, category: "skip_local", action: null, importable: false, reason: item.skip, match: null };
  const m = matches.find((x) => !x.retired && ACTIVE_STATUSES.includes(x.status)) ?? null;
  if (!m) return { ...base, category: "new", action: "create", importable: true, reason: null, match: null };
  if (m.status === "ready" && m.published) {
    return { ...base, category: "published", action: null, importable: false, reason: "已发布:先下架才能覆盖", match: m };
  }
  if (m.status === "ready" && m.segCount > 0 && !m.mediaMissing) {
    if (mode === "overwrite") return { ...base, category: "exists", action: "replace", importable: true, reason: null, match: m };
    return { ...base, category: "exists", action: null, importable: false, reason: "已存在,跳过", match: m };
  }
  if (m.status === "uploading" && m.segCount === 0 && m.uploadTotal === item.mediaBytes) {
    return { ...base, category: "resumable", action: "resume", importable: true, reason: null, match: m };
  }
  return { ...base, category: "busy", action: null, importable: false, reason: "正在处理中或状态不允许", match: m };
}

/** 默认勾选:能导入且不是非英语。 */
export const defaultSelected = (row: PlanRow) => row.importable && !row.item.nonEnglish;
