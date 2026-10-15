import { ApiError, type ApiClient } from "~/api/client";
import type { LibraryLimits } from "./config";

export type { LibraryConfig, LibraryLimits } from "./config";

/** spec §8 的扩展名白名单(服务端为准;有 config.limits.formats 时用它)。 */
export const LIBRARY_FORMATS = ["mp4", "m4v", "mov", "webm", "mkv", "mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"] as const;
export const SUBTITLE_FORMATS = ["srt", "vtt"] as const;
export const MIB = 1024 * 1024;
export const CHUNK_BYTES = 8 * MIB;
export const MAX_SUBTITLE_BYTES = 2 * MIB;
export const MAX_URL_CHARS = 2000;
export const MAX_TITLE_CHARS = 200;
/** 单片 8 MiB 在慢速手机网络上可能超过 ApiClient 默认的 60 s(R-L8)。 */
export const CHUNK_TIMEOUT_MS = 180_000;

export type LibraryKind = "audio" | "video";
export type LibrarySource = "upload" | "link" | "catalog";
export type LibraryStatus = "uploading" | "queued" | "processing" | "ready" | "failed" | "canceled";
export type LibraryStage = "probe" | "fetch" | "transcode" | "subtitles" | "transcribe" | "segment";
export type SubSource = "uploaded" | "platform" | "asr";

/** 列表项(spec §9;ApiClient 已把键转成 camelCase)。 */
export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  source: LibrarySource;
  title: string;
  status: LibraryStatus;
  stage: LibraryStage | null;
  progress: number;
  errorKind: string | null;
  durationMs: number | null;
  segCount: number;
  libraryBytes: number;
  subSource: SubSource | null;
  resumeMs: number;
  resumeIdx: number;
  ratePct: number;
  hasPoster: boolean;
  /** 精选副本:来源目录条目 id(spec 2026-10-14-curated-library E1);普通条目为 null。可选:旧夹具与测试数据可以不带。 */
  catalogId?: string | null;
  /** D5:句边界可能不准(服务端合理性检查;重新识别后重算) */
  lowConfidence: boolean;
  /** plan v2 R-V8:服务端留着识别结果,可以「重新分句」(不花识别额度)。可选:旧夹具与测试里的条目不必带。 */
  rebuildable?: boolean;
  createdAt: string;
  lastOpenedAt: string | null;
}

/** 句子:原始起止毫秒(播放时再加缓冲,spec §6.3 第 6 条)。 */
export interface LibrarySegment {
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
  /**
   * D8:译文与它译成的语言(可空)。用户改了母语后旧译文视为失效 → 显示前一律经 translation-state.zhFor。
   * 可选:旧服务端 / 旧夹具没有这几个键;W2 的测试里构造句子也不必带上它们。
   */
  zh?: string | null;
  zhLang?: string | null;
  /**
   * D8:这一句是否已有缓存的 AI 分析(契约夹具:详情只给 `has_analysis` 布尔,分析正文只在 POST analysis 的回包里)。
   * 可选:W2 的测试里构造句子也不必带上它们。
   */
  hasAnalysis?: boolean;
  analysisLang?: string | null;
  /**
   * plan v2 R-V14:这一句时间可疑的原因码(`rate` / `pause` / `timing` / `estimated` / `seam`);空 = 没有。
   * 用户手动改过时间后服务端清空。可选:旧服务端与测试里的句子没有。
   */
  flags?: string[];
}

export interface LibraryItemDetail extends LibraryItem {
  segments: LibrarySegment[];
}

export interface ItemPage { items: LibraryItem[]; nextCursor: string | null }
export interface ItemPatch { title?: string; resumeMs?: number; resumeIdx?: number; ratePct?: number }
export interface MediaTicket { url: string; expiresIn: number }
export interface UploadStart { itemId: string; chunkBytes: number }
/** 契约夹具:分片与状态回包相同,带 `item_id`、`status`、`chunk_bytes`。 */
export interface UploadStatus { itemId: string; status: LibraryStatus; uploadReceived: number; uploadTotal: number; chunkBytes: number }

const BASE = "/api/library";
const itemPath = (id: string) => `${BASE}/items/${encodeURIComponent(id)}`;
const uploadPath = (id: string) => `${BASE}/uploads/${encodeURIComponent(id)}`;

/**
 * 契约夹具(spec §9 的落地形状):条目类回包都包在 `{item}` 里,详情与补传字幕是 `{item, segments}`。
 * 宽容地也接受裸条目(旧形状 / S2 的 imports 尚未录制)。
 */
export function unwrapItem(reply: unknown): LibraryItem {
  const r = reply as { item?: LibraryItem } & LibraryItem;
  return r.item ?? r;
}

export function unwrapDetail(reply: unknown): LibraryItemDetail {
  const r = reply as { item?: LibraryItem; segments?: LibrarySegment[] } & LibraryItemDetail;
  return r.item ? { ...r.item, segments: r.segments ?? [] } : r;
}

/** 小写扩展名(不含点);没有则为空串。 */
export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** 默认标题 = 文件名主干(去掉目录与最后一个扩展名),最多 200 字。 */
export function stemOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).slice(0, MAX_TITLE_CHARS);
}

/** 开关打开时服务端总会给 limits;万一缺省,按 spec §5.2 的默认值预检(服务端仍是最终裁判)。 */
export function limitsOrDefault(limits: LibraryLimits | null): LibraryLimits {
  return limits ?? {
    maxUploadMb: 500, maxDurationMinutes: 90, quotaMb: 2000, usedBytes: 0, maxItems: 100, chunkBytes: CHUNK_BYTES,
    formats: [...LIBRARY_FORMATS],
  };
}

function subtitleForm(file: Blob, filename: string): FormData {
  const form = new FormData();
  form.append("file", file, `subtitles.${extOf(filename) === "vtt" ? "vtt" : "srt"}`); // 中性文件名(R-L8)
  return form;
}

export async function listItems(api: ApiClient, cursor?: string | null, signal?: AbortSignal): Promise<ItemPage> {
  const page = await api.request<{ items?: LibraryItem[]; nextCursor?: string | null }>("GET", `${BASE}/items`, {
    query: { cursor: cursor ?? undefined }, signal,
  });
  return { items: page.items ?? [], nextCursor: page.nextCursor ?? null };
}

export async function getItem(api: ApiClient, id: string, signal?: AbortSignal): Promise<LibraryItemDetail> {
  return unwrapDetail(await api.request<unknown>("GET", itemPath(id), { signal }));
}

export async function patchItem(api: ApiClient, id: string, patch: ItemPatch): Promise<LibraryItem> {
  return unwrapItem(await api.request<unknown>("PATCH", itemPath(id), { json: patch }));
}

export async function deleteItem(api: ApiClient, id: string): Promise<void> {
  await api.request("DELETE", itemPath(id));
}

export async function retryItem(api: ApiClient, id: string): Promise<LibraryItem> {
  return unwrapItem(await api.request<unknown>("POST", `${itemPath(id)}/retry`));
}

export async function cancelItem(api: ApiClient, id: string): Promise<LibraryItem> {
  return unwrapItem(await api.request<unknown>("POST", `${itemPath(id)}/cancel`));
}

/** D7:重新识别一条自动识别的条目(旧句子保留到新句子写入;额度不足 429 / 不可重新识别 409 / 没开转写 503)。 */
export async function reprocessItem(api: ApiClient, id: string): Promise<LibraryItem> {
  return unwrapItem(await api.request<unknown>("POST", `${itemPath(id)}/reprocess`));
}

/** plan v2 R-V16:用保留的识别结果按当前算法重新分句(不花额度、不排队);返回新的句子。旧素材没有识别结果 → 409。 */
export async function rebuildItem(api: ApiClient, id: string): Promise<LibraryItemDetail> {
  return unwrapDetail(await api.request<unknown>("POST", `${itemPath(id)}/rebuild`));
}

export async function putItemSubtitles(api: ApiClient, id: string, file: Blob, filename: string): Promise<LibraryItem> {
  return unwrapItem(await api.request<unknown>("PUT", `${itemPath(id)}/subtitles`, { form: subtitleForm(file, filename) }));
}

export function mediaTicket(api: ApiClient, id: string): Promise<MediaTicket> {
  return api.request<MediaTicket>("POST", `${itemPath(id)}/media-ticket`);
}

export function fetchPoster(api: ApiClient, id: string, signal?: AbortSignal): Promise<Blob> {
  return api.request<Blob>("GET", `${itemPath(id)}/poster`, { as: "blob", signal });
}

export function startUpload(api: ApiClient, body: { filename: string; size: number; title?: string }, signal?: AbortSignal): Promise<UploadStart> {
  return api.request<UploadStart>("POST", `${BASE}/uploads`, { json: body, signal });
}

export function uploadStatus(api: ApiClient, id: string, signal?: AbortSignal): Promise<UploadStatus> {
  return api.request<UploadStatus>("GET", uploadPath(id), { signal });
}

export function putChunk(api: ApiClient, id: string, n: number, chunk: Blob, signal?: AbortSignal): Promise<UploadStatus> {
  const form = new FormData();
  form.append("chunk", chunk, "chunk");
  return api.request<UploadStatus>("PUT", `${uploadPath(id)}/chunks/${n}`, { form, signal, timeoutMs: CHUNK_TIMEOUT_MS });
}

export async function putUploadSubtitles(api: ApiClient, id: string, file: Blob, filename: string, signal?: AbortSignal): Promise<void> {
  await api.request("PUT", `${uploadPath(id)}/subtitles`, { form: subtitleForm(file, filename), signal });
}

export async function completeUpload(api: ApiClient, id: string, signal?: AbortSignal): Promise<LibraryItem> {
  return unwrapItem(await api.request<unknown>("POST", `${uploadPath(id)}/complete`, { signal }));
}

/** 链接只在 JSON 体里(隐私规则);开关关时服务端 404。 */
export async function importLink(api: ApiClient, body: { url: string; title?: string }): Promise<LibraryItem> {
  return unwrapItem(await api.request<unknown>("POST", `${BASE}/imports`, { json: body }));
}

/** D8:一次最多取这么多句的译文(spec §9)。 */
export const MAX_TRANSLATE_BATCH = 20;

/** `translate` 回包里的一句:idx + 译文(译成哪种语言由请求的 native_language 决定)。 */
export interface TranslatedSegment { idx: number; zh: string }
export interface TranslateResult { items: TranslatedSegment[]; limited: boolean }
export interface AnalysisResult { analysis: string; cached: boolean }

/**
 * D8 / E12:批量取译文(≤ 20 句)。句子文字不在请求里(服务端从库里读),URL 里只有条目 id。契约夹具的回包是
 * `{segments: [{idx, zh}], limited}`;宽容地也接受 `{items, limited}` 与裸数组(计划「跨计划假设」)。`limited` = 额度满,已有的照常返回、缺的没有生成。
 */
export async function translateSegments(
  api: ApiClient, id: string, indices: readonly number[], nativeLanguage: string, signal?: AbortSignal,
): Promise<TranslateResult> {
  if (indices.length > MAX_TRANSLATE_BATCH) throw new RangeError(`at most ${MAX_TRANSLATE_BATCH} sentences per translate call`);
  const reply = await api.request<TranslatedSegment[] | { segments?: TranslatedSegment[]; items?: TranslatedSegment[]; limited?: boolean }>(
    "POST", `${itemPath(id)}/translate`, { json: { indices, nativeLanguage }, signal },
  );
  if (Array.isArray(reply)) return { items: reply, limited: false };
  return { items: reply.segments ?? reply.items ?? [], limited: reply.limited === true };
}

/** D8:某一句的 AI 分析(只在用户点「分析」时调用,不预取;额度满 → 429,见 isAiLimited)。URL 里只有条目 id 与句序号。 */
export function analyzeSegment(api: ApiClient, id: string, idx: number, nativeLanguage: string, signal?: AbortSignal): Promise<AnalysisResult> {
  return api.request<AnalysisResult>("POST", `${itemPath(id)}/segments/${idx}/analysis`, { json: { nativeLanguage }, signal });
}

/** 条目不在了(404 `Not Found`);`Library is disabled` 等其他 404 不算。 */
export function isItemNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && err.message === "Not Found";
}

/** 额度满(429)。调用方显示一次固定提示,不逐句报错;播放与跟读不受影响。 */
export function isAiLimited(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

/**
 * 服务端固定英文错误文本 → 文案键(契约夹具 `errors` 录的是 server/app/library/errors.py 的 API_ERRORS;未命中走通用提示)。
 * `Invalid URL` 不在夹具里:链接导入(S2)的文本尚未录制,先保留。
 */
export const LIBRARY_SERVER_ERRORS: Record<string, string> = {
  "Library is disabled": "web.library.errors.disabled",
  "Built-in library is disabled": "web.library.errors.catalogDisabled",
  "Built-in item not found": "web.library.errors.catalogNotFound",
  "Built-in items cannot be changed this way": "web.library.errors.catalogLocked",
  "Not Found": "web.library.errors.notFound",
  "Sentence not found": "web.library.errors.notFound",
  "Media tools are not installed": "web.library.errors.mediaTools",
  "Unsupported file type": "web.library.errors.unsupportedFormat",
  "File is too large": "web.library.errors.tooLarge",
  "Chunk is too large": "web.library.errors.chunkTooLarge",
  "Library storage quota reached": "web.library.errors.quota",
  "Library item limit reached": "web.library.errors.maxItems",
  "Too many uploads in progress": "web.library.errors.concurrentUploads",
  "Daily import limit reached": "web.library.errors.dailyLimit",
  "Upload is not in progress": "web.library.errors.invalidState",
  "Unexpected chunk": "web.library.errors.chunkOrder",
  "Wrong chunk size": "web.library.errors.chunkOrder",
  "Chunk is required": "web.library.errors.chunkOrder",
  "Upload is incomplete": "web.library.errors.uploadIncomplete",
  "Upload expired": "web.library.errors.uploadExpired",
  "Subtitle file is required": "web.library.errors.badSubtitle",
  "Invalid subtitle file": "web.library.errors.badSubtitle",
  "Subtitles cannot be changed now": "web.library.errors.invalidState",
  "Item is not ready": "web.library.errors.notReady",
  "Item has not failed": "web.library.errors.invalidState",
  "Nothing left to retry": "web.library.errors.invalidState",
  "Item cannot be reprocessed": "web.library.errors.notReprocessable",
  "Item cannot be rebuilt": "web.library.errors.notRebuildable",
  "Transcription is not available": "web.library.errors.asrUnavailable",
  "Daily transcription limit reached": "web.library.errors.asrLimited",
  "Item cannot be canceled": "web.library.errors.invalidState",
  "No changes": "web.library.errors.invalidState",
  "Invalid resume position": "web.library.errors.invalidState",
  "Invalid sentence text": "web.library.errors.invalidState",
  "Invalid sentence times": "web.library.errors.invalidState",
  "Assessment does not match": "web.library.errors.invalidState",
  "Invalid ticket": "web.library.errors.invalidState",
  "Unsupported language": "web.library.errors.invalidState",
  "AI is disabled": "web.library.errors.aiDisabled",
  "AI is unavailable": "web.library.errors.aiUnavailable",
  "Daily AI limit reached": "web.library.errors.aiLimited",
  "Daily analysis limit reached": "web.library.errors.aiLimited",
  "Invalid URL": "web.library.errors.badUrl",
};
