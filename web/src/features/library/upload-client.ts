import { ApiError, type ApiClient } from "~/api/client";
import {
  CHUNK_BYTES, completeUpload, putChunk, putUploadSubtitles, startUpload, uploadStatus, type LibraryItem,
} from "./library-api";

/** 每片失败后自动重试 3 次(spec §11.3),间隔 1 s / 2 s / 4 s(R-L8)。 */
export const CHUNK_RETRIES = 3;
export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
/** 409(次序不对)后按服务端进度重新对齐的最多次数。 */
export const MAX_RESYNCS = 3;

export interface UploadInput {
  file: Blob;
  /** 原文件名:只进 POST /uploads 的 JSON 体(取扩展名与默认标题),不进 URL、不进 multipart。 */
  filename: string;
  title?: string;
  subtitles?: { file: Blob; filename: string } | null;
}

export interface UploadOptions {
  /** 续传:已有的条目 id(R-L7、R-L10)。 */
  resumeItemId?: string;
  /** 续传时的分片大小(新上传以服务端返回的为准)。 */
  chunkBytes?: number;
  signal?: AbortSignal;
  onItem?: (itemId: string) => void;
  onProgress?: (sent: number, total: number) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class UploadMismatchError extends Error {
  constructor() {
    super("Upload size mismatch");
    this.name = "UploadMismatchError";
  }
}

/** 网络 / 超时(不是用户中止)、429、5xx 可重试;其他 4xx 立即失败(R-L8)。 */
export function isRetryable(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || !(err instanceof ApiError)) return false;
  return err.status === 0 || err.status === 429 || err.status >= 500;
}

const aborted = () => new ApiError(0, "Request aborted");

export function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function withRetries<T>(fn: () => Promise<T>, signal: AbortSignal | undefined, sleep: NonNullable<UploadOptions["sleep"]>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= CHUNK_RETRIES || !isRetryable(err, signal)) throw err;
      await sleep(RETRY_DELAYS_MS[attempt], signal);
    }
  }
}

/**
 * 分片上传一个文件(spec §8):开始 → (字幕)→ 逐片串行 → 完成。续传时先问服务端已收多少。
 * 中止由 signal 传到每个请求;失败时条目留在服务端的 uploading 状态,可续传(R-L9)。
 */
export async function uploadFile(api: ApiClient, input: UploadInput, opts: UploadOptions = {}): Promise<LibraryItem> {
  const { signal } = opts;
  const sleep = opts.sleep ?? sleepFor;
  const total = input.file.size;
  let itemId: string;
  let chunkBytes = opts.chunkBytes ?? CHUNK_BYTES;
  let received = 0;
  if (opts.resumeItemId) {
    const id = opts.resumeItemId;
    itemId = id;
    const status = await withRetries(() => uploadStatus(api, id, signal), signal, sleep);
    if (status.uploadTotal !== total) throw new UploadMismatchError();
    received = status.uploadReceived;
    opts.onItem?.(itemId);
  } else {
    const started = await startUpload(api, { filename: input.filename, size: total, title: input.title?.trim() || undefined }, signal);
    const id = started.itemId;
    itemId = id;
    if (started.chunkBytes > 0) chunkBytes = started.chunkBytes;
    opts.onItem?.(itemId);
    const subs = input.subtitles;
    if (subs) await withRetries(() => putUploadSubtitles(api, id, subs.file, subs.filename, signal), signal, sleep);
  }
  opts.onProgress?.(received, total);
  let n = Math.floor(received / chunkBytes);
  let resyncs = 0;
  while (n * chunkBytes < total) {
    const start = n * chunkBytes;
    const chunk = input.file.slice(start, Math.min(total, start + chunkBytes));
    const index = n;
    try {
      await withRetries(() => putChunk(api, itemId, index, chunk, signal), signal, sleep);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409) || resyncs >= MAX_RESYNCS) throw err;
      resyncs += 1;
      const status = await withRetries(() => uploadStatus(api, itemId, signal), signal, sleep);
      n = Math.floor(status.uploadReceived / chunkBytes);
      opts.onProgress?.(Math.min(total, status.uploadReceived), total);
      continue;
    }
    n += 1;
    opts.onProgress?.(Math.min(total, start + chunk.size), total);
  }
  return withRetries(() => completeUpload(api, itemId, signal), signal, sleep);
}
