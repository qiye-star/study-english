import { ROOM_NOTICE_VOICE_UNCLEAR, type RoomMessage } from "../protocol";

export type TurnVoice = "none" | "recognizing" | "unclear";

export const maxSeq = (messages: readonly RoomMessage[]): number => messages.reduce((n, m) => Math.max(n, m.seq), 0);

/**
 * 轮到我时我发的语音的识别状态(spec addressing §3.2 第 3 条,R-AW12):只看 seq > sinceSeq(轮到我那一刻列表里最大的 seq)的、
 * 我自己的、没被隐藏的语音,最新一条在转写 → 识别中;为空 / 失败 → 没听清。服务端的 voice_unclear 提示也算没听清。
 * 识别成功由服务端推进带练(下一帧),这里什么都不显示。
 */
export function turnVoice(messages: readonly RoomMessage[], meId: number | null, sinceSeq: number, notice: string | null): TurnVoice {
  let last: RoomMessage | undefined;
  for (const m of messages) {
    if (m.seq > sinceSeq && m.kind === "voice" && !m.hidden && m.sender.kind === "user" && m.sender.id === meId) last = m;
  }
  const status = last?.voice?.status;
  if (status === "pending") return "recognizing";
  if (status === "empty" || status === "failed") return "unclear";
  return notice === ROOM_NOTICE_VOICE_UNCLEAR ? "unclear" : "none";
}
