import camelcaseKeys from "camelcase-keys";

/** 与 server/app/realtime_protocol.py 逐字对应(protocol.test.ts 直接读取服务端文件核对)。 */
export const CLOSE = {
  NORMAL: 1000, UNAUTHORIZED: 4001, DISABLED: 4003, NOT_FOUND: 4004, IDLE: 4008,
  MAX_DURATION: 4009, MESSAGE_LIMIT: 4013, BUSY: 4029, PROTOCOL: 4400, UPSTREAM: 4502,
} as const;

export const CLOSE_REASONS: Record<number, string> = {
  1000: "normal", 4001: "unauthorized", 4003: "disabled", 4004: "not_found", 4008: "idle_timeout",
  4009: "max_duration", 4013: "message_limit", 4029: "busy", 4400: "protocol", 4502: "upstream",
};

export function closeErrorKey(code: number): string | null {
  if (code === CLOSE.NORMAL) return null;
  return `web.realtime.errors.${CLOSE_REASONS[code] ?? "generic"}`;
}

export type RealtimeErrorCode = "asr_failed" | "llm_failed" | "tts_failed" | "rate_limited" | "message_limit";
export type ServerEvent =
  | { type: "ready"; asr: "stream" | "buffered" }
  | { type: "state"; state: "listening" | "thinking" | "speaking" }
  | { type: "transcript_partial"; text: string }
  | { type: "transcript_final"; text: string; messageId: string | null }
  | { type: "reply_delta"; turnId: number; text: string }
  | { type: "reply_done"; turnId: number; messageId: string | null; interrupted: boolean }
  | { type: "assessment"; messageId: string; status: "done" | "failed" | "quota"; result?: Record<string, unknown>; assessmentId?: string | null }
  | { type: "degraded"; reason: "asr" }
  | { type: "error"; code: RealtimeErrorCode };

const TYPES = new Set(["ready", "state", "transcript_partial", "transcript_final", "reply_delta", "reply_done", "assessment", "degraded", "error"]);

export function parseServerEvent(text: string): ServerEvent | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object" || !TYPES.has((raw as { type?: string }).type ?? "")) return null;
    return camelcaseKeys(raw as Record<string, unknown>, { deep: true }) as unknown as ServerEvent;
  } catch {
    return null;
  }
}

export function splitAudioFrame(data: ArrayBuffer): { turnId: number; pcm: Int16Array } | null {
  if (data.byteLength < 4 || (data.byteLength - 4) % 2) return null;
  return { turnId: new DataView(data).getUint32(0), pcm: new Int16Array(data.slice(4)) };
}

export interface StartPayload {
  systemPrompt: string;
  model: string;
  temperature: number;
  voice: string;
  saveRecordings: boolean;
}

export function encodeStart(p: StartPayload): string {
  return JSON.stringify({
    type: "start", system_prompt: p.systemPrompt, model: p.model, temperature: p.temperature, voice: p.voice,
    language: "en", save_recordings: p.saveRecordings,
  });
}

export const encodeControl = (type: "utterance_end" | "interrupt" | "hangup") => JSON.stringify({ type });
