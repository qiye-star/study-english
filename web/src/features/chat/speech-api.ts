import type { ApiClient } from "~/api/client";

export function transcribe(api: ApiClient, wav: Blob, language = "en"): Promise<{ text: string }> {
  const form = new FormData();
  form.append("file", new File([wav], "recording.wav", { type: "audio/wav" }));
  form.append("model", "whisper-1");
  form.append("language", language);
  form.append("response_format", "json");
  return api.request("POST", "/api/ai/audio/transcriptions", { form, timeoutMs: 300_000 });
}

export function synthesizeSpeech(
  api: ApiClient,
  params: { input: string; model: string; voice: string },
  signal?: AbortSignal,
): Promise<Blob> {
  return api.request("POST", "/api/ai/audio/speech", { json: params, as: "blob", timeoutMs: 120_000, signal });
}
