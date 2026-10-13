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
export type LibrarySource = "upload" | "link";
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
  ratePct: number;
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
  /** D8:AI 分析的原文与语言(可空;W2 的分析卡使用,本车道的列表不显示) */
  analysis?: string | null;
  analysisLang?: string | null;
}

export interface LibraryItemDetail extends LibraryItem {
  resumeIdx: number;
  segments: LibrarySegment[];
}

export interface ItemPage { items: LibraryItem[]; nextCursor: string | null }
export interface ItemPatch { title?: string; resumeMs?: number; resumeIdx?: number; ratePct?: number }
export interface MediaTicket { url: string; expiresIn: number }
export interface UploadStart { itemId: string; chunkBytes: number }
export interface UploadStatus { uploadReceived: number; uploadTotal: number }

const BASE = "/api/library";
const itemPath = (id: string) => `${BASE}/items/${encodeURIComponent(id)}`;
const uploadPath = (id: string) => `${BASE}/uploads/${encodeURIComponent(id)}`;

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

export function getItem(api: ApiClient, id: string, signal?: AbortSignal): Promise<LibraryItemDetail> {
  return api.request<LibraryItemDetail>("GET", itemPath(id), { signal });
}

export function patchItem(api: ApiClient, id: string, patch: ItemPatch): Promise<LibraryItem> {
  return api.request<LibraryItem>("PATCH", itemPath(id), { json: patch });
}

export async function deleteItem(api: ApiClient, id: string): Promise<void> {
  await api.request("DELETE", itemPath(id));
}

export function retryItem(api: ApiClient, id: string): Promise<LibraryItem> {
  return api.request<LibraryItem>("POST", `${itemPath(id)}/retry`);
}

export function cancelItem(api: ApiClient, id: string): Promise<LibraryItem> {
  return api.request<LibraryItem>("POST", `${itemPath(id)}/cancel`);
}

export function putItemSubtitles(api: ApiClient, id: string, file: Blob, filename: string): Promise<LibraryItem> {
  return api.request<LibraryItem>("PUT", `${itemPath(id)}/subtitles`, { form: subtitleForm(file, filename) });
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

export function completeUpload(api: ApiClient, id: string, signal?: AbortSignal): Promise<LibraryItem> {
  return api.request<LibraryItem>("POST", `${uploadPath(id)}/complete`, { signal });
}

/** 链接只在 JSON 体里(隐私规则);开关关时服务端 404。 */
export function importLink(api: ApiClient, body: { url: string; title?: string }): Promise<LibraryItem> {
  return api.request<LibraryItem>("POST", `${BASE}/imports`, { json: body });
}

/** D8:一次最多取这么多句的译文(spec §9)。 */
export const MAX_TRANSLATE_BATCH = 20;

/** `translate` 回包里的一句:idx + 译文(译成哪种语言由请求的 native_language 决定)。 */
export interface TranslatedSegment { idx: number; zh: string }
export interface TranslateResult { items: TranslatedSegment[]; limited: boolean }
export interface AnalysisResult { analysis: string; cached: boolean }

/**
 * D8 / E12:批量取译文(≤ 20 句)。句子文字不在请求里(服务端从库里读),URL 里只有条目 id。回包形状 S1 未定稿:
 * 接受 `{items, limited}` 与裸数组两种(计划「跨计划假设」)。`limited` = 额度满,已有的照常返回、缺的没有生成。
 */
export async function translateSegments(
  api: ApiClient, id: string, indices: readonly number[], nativeLanguage: string, signal?: AbortSignal,
): Promise<TranslateResult> {
  if (indices.length > MAX_TRANSLATE_BATCH) throw new RangeError(`at most ${MAX_TRANSLATE_BATCH} sentences per translate call`);
  const reply = await api.request<TranslatedSegment[] | { items?: TranslatedSegment[]; limited?: boolean }>(
    "POST", `${itemPath(id)}/translate`, { json: { indices, nativeLanguage }, signal },
  );
  if (Array.isArray(reply)) return { items: reply, limited: false };
  return { items: reply.items ?? [], limited: reply.limited === true };
}

/** D8:某一句的 AI 分析(只在用户点「分析」时调用,不预取;额度满 → 429,见 isAiLimited)。URL 里只有条目 id 与句序号。 */
export function analyzeSegment(api: ApiClient, id: string, idx: number, nativeLanguage: string, signal?: AbortSignal): Promise<AnalysisResult> {
  return api.request<AnalysisResult>("POST", `${itemPath(id)}/segments/${idx}/analysis`, { json: { nativeLanguage }, signal });
}

/** 额度满(429)。调用方显示一次固定提示,不逐句报错;播放与跟读不受影响。 */
export function isAiLimited(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

/** 服务端固定英文错误文本 → 文案键(计划「跨计划假设」;未命中走通用提示)。 */
export const LIBRARY_SERVER_ERRORS: Record<string, string> = {
  "Library item not found": "web.library.errors.notFound",
  "Not Found": "web.library.errors.notFound",
  "Quota exceeded": "web.library.errors.quota",
  "Too many items": "web.library.errors.maxItems",
  "File too large": "web.library.errors.tooLarge",
  "Unsupported format": "web.library.errors.unsupportedFormat",
  "Daily import limit reached": "web.library.errors.dailyLimit",
  "Too many uploads in progress": "web.library.errors.concurrentUploads",
  "Chunk out of order": "web.library.errors.chunkOrder",
  "Chunk too large": "web.library.errors.chunkTooLarge",
  "Upload incomplete": "web.library.errors.uploadIncomplete",
  "Invalid subtitle file": "web.library.errors.badSubtitle",
  "Invalid URL": "web.library.errors.badUrl",
  "Item not ready": "web.library.errors.notReady",
  "Invalid state": "web.library.errors.invalidState",
  "Daily AI limit reached": "web.library.errors.aiLimited",
};
