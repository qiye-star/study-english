import type { ApiClient } from "~/api/client";
import { ROOM_LIMITS, type RoomMessage } from "../protocol";

/** 语音接口的服务端错误原文(spec 2026-10-10 §8)→ i18n key(translateServerError 的 extra 表)。 */
export const ROOM_VOICE_SERVER_ERRORS: Record<string, string> = {
  "Voice messages are off": "web.rooms.voice.errors.voiceOff",
  "Expected 16 kHz mono WAV": "web.rooms.voice.errors.badFormat",
  "Audio too short": "web.rooms.voice.errors.tooShort",
  "Audio too long": "web.rooms.voice.errors.tooLong",
  "Audio file is too large": "web.rooms.voice.errors.tooLarge",
  "Voice storage quota reached": "web.rooms.voice.errors.quota",
  "Daily voice limit reached": "web.rooms.voice.errors.daily",
  "Invalid reply": "web.rooms.voice.errors.badReply",
  "Audio removed": "web.rooms.voice.errors.removed",
};

const voicePath = (roomId: string) => `/api/rooms/${encodeURIComponent(roomId)}/voice`;

/** 上传一条语音(16 kHz 单声道 16 位 WAV)。同一 clientId 重复上传由服务端去重,返回原消息。
 *  toAgent:「对象」生效时的角色 id(spec addressing §3.4),转写成功后由服务端交给该智能体;null = 只发给房间。 */
export function uploadVoice(api: ApiClient, roomId: string, wav: Blob, clientId: string, replyTo: number | null,
  toAgent: string | null = null): Promise<{ seq: number; message: RoomMessage }> {
  const form = new FormData();
  form.append("file", new File([wav], "voice.wav", { type: "audio/wav" }));
  form.append("client_id", clientId);
  if (replyTo !== null) form.append("reply_to", String(replyTo));
  const to = toAgent?.trim().slice(0, ROOM_LIMITS.id);
  if (to) form.append("to_agent", to);
  return api.request("POST", voicePath(roomId), { form, timeoutMs: 120_000 });
}

/** 带鉴权取一条语音的音频(audio/mpeg;410 = 已被管理员清理)。只在用户点播放时调用。 */
export function fetchVoiceAudio(api: ApiClient, roomId: string, messageId: string, signal?: AbortSignal): Promise<Blob> {
  return api.request("GET", `${voicePath(roomId)}/${encodeURIComponent(messageId)}`, { as: "blob", signal });
}
