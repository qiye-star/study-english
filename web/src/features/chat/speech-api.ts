import type { ApiClient } from "~/api/client";

/** language 为 null 时不带语言提示,让转写逐字保留原语言(语音消息需要据此判断是否英文,R1)。 */
export function transcribe(api: ApiClient, wav: Blob, language: string | null = "en", signal?: AbortSignal): Promise<{ text: string }> {
  const form = new FormData();
  form.append("file", new File([wav], "recording.wav", { type: "audio/wav" }));
  form.append("model", "whisper-1");
  if (language) form.append("language", language);
  form.append("response_format", "json");
  return api.request("POST", "/api/ai/audio/transcriptions", { form, timeoutMs: 300_000, signal });
}

export function synthesizeSpeech(
  api: ApiClient,
  params: { input: string; model: string; voice: string },
  signal?: AbortSignal,
): Promise<Blob> {
  return api.request("POST", "/api/ai/audio/speech", { json: params, as: "blob", timeoutMs: 120_000, signal });
}
