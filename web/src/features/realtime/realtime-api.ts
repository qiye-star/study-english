import { transcribe } from "~/api/ai";
import type { ApiClient } from "~/api/client";
import { TARGET_RATE } from "~/audio/pcm";
import { encodeWavPcm16 } from "~/audio/wav";

export interface RealtimeConfig {
  enabled: boolean;
  maxMinutes: number;
  idleTimeoutSeconds: number;
  asrMode: "stream" | "buffered";
  sampleRateIn: number;
  sampleRateOut: number;
}

export const REALTIME_SERVER_ERRORS: Record<string, string> = {
  "Realtime is not enabled": "web.realtime.errors.disabled",
};

export function fetchRealtimeConfig(api: ApiClient, signal?: AbortSignal): Promise<RealtimeConfig> {
  return api.request("GET", "/api/realtime/config", { signal });
}

export function createRealtimeTicket(api: ApiClient, conversationId: string, signal?: AbortSignal): Promise<{ ticket: string; expiresIn: number }> {
  return api.request("POST", "/api/realtime/ticket", { json: { conversationId }, signal });
}

/** 一次性票据放在查询串里(60 s、只能用一次);登录令牌从不进 URL(设计文档 §3.5)。 */
export function realtimeUrl(ticket: string, loc: { protocol: string; host: string }): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/api/realtime?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * 通话里"转文字":把按住的音频(16 kHz 单声道)编码成 WAV,走与聊天语音消息相同的转写接口(英文提示)。
 * 返回去掉首尾空白的文字("" = 没听到话)。
 */
export async function transcribeHeldAudio(api: ApiClient, audio: Float32Array, signal?: AbortSignal): Promise<string> {
  const wav = new Blob([encodeWavPcm16(audio, TARGET_RATE)], { type: "audio/wav" });
  const { text } = await transcribe(api, wav, "en", signal);
  return (text ?? "").trim();
}
