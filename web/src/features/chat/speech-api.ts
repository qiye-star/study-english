import type { ApiClient } from "~/api/client";

/** 转写在 api/ai.ts(通话的"转文字"也用);这里保留原来的入口。 */
export { transcribe } from "~/api/ai";

export function synthesizeSpeech(
  api: ApiClient,
  params: { input: string; model: string; voice: string },
  signal?: AbortSignal,
): Promise<Blob> {
  return api.request("POST", "/api/ai/audio/speech", { json: params, as: "blob", timeoutMs: 120_000, signal });
}
