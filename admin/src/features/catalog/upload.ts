/**
 * 分片上传(R-AU2):逐片串行,失败的分片重试 2 次;abort 立即停止。返回最后的上传状态。
 * `startChunk`(导入包续传,R-A5)从该片起发;服务端对已收分片幂等。默认 0 时行为不变。
 */
import { putChunk, type UploadState } from "./api";

export interface UploadProgress { sent: number; total: number }

export async function uploadChunks(
  id: string, file: Blob, chunkBytes: number, onProgress: (p: UploadProgress) => void, signal?: AbortSignal,
  send: typeof putChunk = putChunk,
  startChunk = 0,
): Promise<UploadState | null> {
  const count = Math.max(1, Math.ceil(file.size / chunkBytes));
  let last: UploadState | null = null;
  for (let n = startChunk; n < count; n++) {
    const blob = file.slice(n * chunkBytes, Math.min(file.size, (n + 1) * chunkBytes));
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      try {
        last = await send(id, n, blob, signal);
        break;
      } catch (e) {
        if ((e instanceof DOMException && e.name === "AbortError") || attempt >= 2) throw e;
      }
    }
    onProgress({ sent: Math.min(file.size, (n + 1) * chunkBytes), total: file.size });
  }
  return last;
}
