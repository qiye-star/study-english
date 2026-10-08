import { closeErrorKey, type ServerEvent } from "./protocol";

/** 说话方式:`auto` = 自动检测(Silero 或基础能量检测);`ptt` = 只在按住时上行。两者互斥。 */
export type InputMode = "auto" | "ptt";
export type CallPhase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended";
export interface Caption {
  key: string;
  role: "user" | "assistant";
  text: string;
  messageId?: string | null;
  turnId?: number;
  interrupted?: boolean;
  score?: number | null;
}
export interface CallModel {
  phase: CallPhase;
  captions: Caption[];
  partial: string;
  muted: boolean;
  inputMode: InputMode;
  /** 正按住说话键(任何模式下按住都是手动的一句) */
  holding: boolean;
  /** Silero 没能加载:自动模式改用基础(能量)检测;不锁定说话方式 */
  vadUnavailable: boolean;
  /** 免提(外放):更大的音量、机器人说话时半双工 */
  speaker: boolean;
  degraded: boolean;
  notice: string | null;
  error: string | null;
}
export type CallAction =
  | { type: "connect" }
  | { type: "event"; event: ServerEvent }
  | { type: "closed"; code: number }
  | { type: "fail"; errorKey: string }
  | { type: "mute"; muted: boolean }
  | { type: "input-mode"; mode: InputMode }
  | { type: "holding"; on: boolean }
  | { type: "speaker"; on: boolean }
  | { type: "notice"; key: string | null }
  | { type: "local-interrupt" }
  | { type: "clear-partial" }
  | { type: "vad-unavailable" };

export const MAX_CAPTIONS = 50;
export const INITIAL_CALL: CallModel = {
  phase: "idle", captions: [], partial: "", muted: false, inputMode: "auto", holding: false, vadUnavailable: false, speaker: false, degraded: false, notice: null, error: null,
};

const cap = (captions: Caption[]) => captions.slice(-MAX_CAPTIONS);

/** 没有 messageId(服务端未保存)的用户字幕:取一个当前列表里没用过的键。 */
function userKey(captions: Caption[], messageId: string | null): string {
  if (messageId) return `u-${messageId}`;
  let n = captions.length;
  while (captions.some((c) => c.key === `u-n${n}`)) n++;
  return `u-n${n}`;
}

function onEvent(m: CallModel, e: ServerEvent): CallModel {
  switch (e.type) {
    case "ready":
      return { ...m, phase: "listening" };
    case "state":
      return { ...m, phase: e.state };
    case "transcript_partial":
      return { ...m, partial: e.text };
    case "transcript_final":
      if (!e.text) return { ...m, partial: "", notice: "web.realtime.noSpeech" };
      return {
        ...m, partial: "", notice: null,
        captions: cap([...m.captions, { key: userKey(m.captions, e.messageId), role: "user", text: e.text, messageId: e.messageId }]),
      };
    case "reply_delta": {
      const i = m.captions.findIndex((c) => c.role === "assistant" && c.turnId === e.turnId);
      if (i < 0) return { ...m, captions: cap([...m.captions, { key: `a-${e.turnId}`, role: "assistant", text: e.text, turnId: e.turnId }]) };
      const captions = m.captions.slice();
      captions[i] = { ...captions[i], text: captions[i].text + e.text };
      return { ...m, captions };
    }
    case "reply_done":
      return {
        ...m,
        captions: m.captions.map((c) => (c.role === "assistant" && c.turnId === e.turnId ? { ...c, messageId: e.messageId, interrupted: c.interrupted || e.interrupted } : c)),
      };
    case "assessment": {
      const raw = e.status === "done" ? Number((e.result as { pronunciationScore?: unknown } | undefined)?.pronunciationScore) : NaN;
      const score = Number.isFinite(raw) ? Math.round(raw) : null;
      return { ...m, captions: m.captions.map((c) => (c.role === "user" && c.messageId === e.messageId ? { ...c, score } : c)) };
    }
    case "degraded":
      return { ...m, degraded: true };
    case "error":
      return { ...m, notice: `web.realtime.errors.${e.code}` };
    default:
      return m;
  }
}

export function callReducer(m: CallModel, a: CallAction): CallModel {
  if (m.phase === "ended" && a.type !== "notice") return m;
  switch (a.type) {
    case "connect":
      return { ...m, phase: "connecting", error: null };
    case "event":
      return onEvent(m, a.event);
    case "closed":
      return { ...m, phase: "ended", partial: "", error: closeErrorKey(a.code) };
    case "fail":
      return { ...m, phase: "ended", partial: "", error: a.errorKey };
    case "mute":
      return { ...m, muted: a.muted };
    case "input-mode":
      return { ...m, inputMode: a.mode, holding: false };
    case "holding":
      return { ...m, holding: a.on };
    case "speaker":
      return { ...m, speaker: a.on };
    case "notice":
      return { ...m, notice: a.key };
    case "clear-partial":
      return m.partial ? { ...m, partial: "" } : m;
    case "vad-unavailable":
      return { ...m, vadUnavailable: true, notice: "web.realtime.vadUnavailable" };
    case "local-interrupt": {
      // 只标记还在流式输出(尚未收到 reply_done,messageId 仍为 undefined)的那条回复;
      // 思考阶段打断时新一轮还没有字幕,已说完的上一轮不能被标成"已打断"
      let last = -1;
      m.captions.forEach((c, i) => { if (c.role === "assistant" && c.messageId === undefined) last = i; });
      const captions = last < 0 ? m.captions : m.captions.map((c, i) => (i === last ? { ...c, interrupted: true } : c));
      return { ...m, captions, phase: "listening" };
    }
  }
}
