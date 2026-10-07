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

/** 服务端 StartMsg 的限制(protocol.test.ts 直接读取服务端文件核对)。字符数按 Python 的 len(码点)计。 */
export const START_LIMITS = {
  systemPrompt: 8000,
  model: 200,
  voice: /^[A-Za-z0-9_-]{3,100}$/,
  /** 一条客户端文本消息的上限(MAX_CLIENT_TEXT) */
  clientText: 16_384,
} as const;

/** 开始消息无法满足服务端校验(目前只有音色:它没有可退回的默认值)。 */
export class StartPayloadError extends Error {
  constructor(readonly field: "voice") {
    super(`invalid start payload: ${field}`);
    this.name = "StartPayloadError";
  }
}

const codePoints = (s: string) => Array.from(s);

/**
 * 编码开始消息,并把它收进服务端的限制里(超限的服务端会以 4400 关闭,用户只看到笼统的报错):
 * 提示词按码点截到 8000(不拆代理对),整条消息再按 MAX_CLIENT_TEXT 收紧;模型名过长时用服务端默认;
 * 温度夹到 [0, 2](非数字用 0.7);音色不合法则抛 StartPayloadError(没有可退回的值)。
 */
export function encodeStart(p: StartPayload): string {
  if (!START_LIMITS.voice.test(p.voice)) throw new StartPayloadError("voice");
  const model = codePoints(p.model).length <= START_LIMITS.model ? p.model : "";
  const temperature = Number.isFinite(p.temperature) ? Math.min(2, Math.max(0, p.temperature)) : 0.7;
  const prompt = codePoints(p.systemPrompt ?? "").slice(0, START_LIMITS.systemPrompt);
  const encode = (n: number) => JSON.stringify({
    type: "start", system_prompt: prompt.slice(0, n).join(""), model, temperature, voice: p.voice,
    language: "en", save_recordings: p.saveRecordings,
  });
  const fits = (n: number) => codePoints(encode(n)).length <= START_LIMITS.clientText;
  if (fits(prompt.length)) return encode(prompt.length);
  // 转义(换行、引号、控制字符)让 JSON 比提示词长:二分找能放下的最长前缀
  let lo = 0;
  let hi = prompt.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return encode(lo);
}

export const encodeControl = (type: "utterance_end" | "interrupt" | "hangup") => JSON.stringify({ type });
