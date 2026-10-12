import { readJson, writeJson } from "~/lib/storage";
import { mentionsAi, type RoomMessage, type RoomTutorInfo } from "../protocol";
import { agentOf } from "./agent-meta";
import { mentionsAgent } from "./mentions";
import type { RoomAgent } from "./room-agents-api";

/**
 * 「对象」标签的纯逻辑(spec 2026-10-12-agents-addressing §3.2 第 2 条、§3.3;D2;R-AW3–R-AW7、R-AW15)。
 * 状态只记在本机(按用户 + 房间);服务端不保存,客户端每次发送时带 to。
 */
export interface TargetAuto { sig: string; sinceSeq: number }
export interface TargetState {
  on: boolean;
  personaId: string | null;
  /** 由带练自动打开时:带练签名与当时的 seq(之后的结束消息才算这次带练结束) */
  auto: TargetAuto | null;
  /** 结束消息先于带练帧清空到达时记下签名,帧清空后清掉(同一签名的下一次带练仍会自动打开) */
  ended: string | null;
}
export const TARGET_OFF: TargetState = Object.freeze({ on: false, personaId: null, auto: null, ended: null }) as TargetState;

export const targetKey = (userId: number, roomId: string) => `enjoy-web.rooms.target.v1.${userId}.${roomId}`;
const isAuto = (v: unknown): v is TargetAuto =>
  !!v && typeof (v as TargetAuto).sig === "string" && Number.isInteger((v as TargetAuto).sinceSeq);
function isTarget(v: unknown): v is TargetState {
  const o = v as Partial<TargetState> | null;
  return !!o && typeof o === "object" && typeof o.on === "boolean" && (o.personaId === null || typeof o.personaId === "string")
    && (o.auto === null || isAuto(o.auto)) && (o.ended === null || typeof o.ended === "string");
}
/** 取不到(隐私模式、被禁用、内容不对)= 关闭。 */
export function loadTarget(userId: number | null, roomId: string): TargetState {
  if (userId === null || !roomId) return TARGET_OFF;
  return readJson(targetKey(userId, roomId), isTarget) ?? TARGET_OFF;
}
export function saveTarget(userId: number | null, roomId: string, s: TargetState): void {
  if (userId !== null && roomId) writeJson(targetKey(userId, roomId), s);
}

/** 带练帧没有会话 id:用开启者、角色、题数区分一次带练。 */
export const tutorSig = (t: RoomTutorInfo): string => `${t.startedBy}:${t.personaId}:${t.stepsTotal}`;
const ENDED = new Set(["tutor_stopped", "tutor_done"]);
export const tutorEnded = (messages: readonly RoomMessage[], sinceSeq: number): boolean =>
  messages.some((m) => m.kind === "system" && m.seq > sinceSeq && ENDED.has(m.text));

export interface TargetInput { tutor: RoomTutorInfo | null; messages: readonly RoomMessage[]; seq: number; closed: boolean }
/** 自动开关(R-AW4):带练第一次出现 → 打开;它的结束消息 / 房间关闭 → 关闭。没有变化时返回同一个对象。 */
export function nextTarget(s: TargetState, i: TargetInput): TargetState {
  if (i.closed) return s.on || s.auto || s.ended ? { ...s, on: false, auto: null, ended: null } : s;
  if (s.auto && tutorEnded(i.messages, s.auto.sinceSeq)) return { ...s, on: false, auto: null, ended: i.tutor ? tutorSig(i.tutor) : null };
  if (!i.tutor) return s.ended ? { ...s, ended: null } : s;
  const sig = tutorSig(i.tutor);
  if (s.auto?.sig === sig || s.ended === sig) return s;
  return { on: true, personaId: i.tutor.personaId, auto: { sig, sinceSeq: i.seq }, ended: null };
}

export type TargetBlock = "muted" | "aiOff" | "unavailable" | "agentOff";
/** 置灰原因(spec §3.3),顺序固定:管理员静音 > 房主关闭公共 AI > 服务端没有 AI > 角色停用。 */
export function targetBlock(p: { aiMuted: boolean; aiPublic: boolean; aiAvailable: boolean; agent: RoomAgent | null }): TargetBlock | null {
  if (p.aiMuted) return "muted";
  if (!p.aiPublic) return "aiOff";
  if (!p.aiAvailable) return "unavailable";
  if (p.agent?.disabled) return "agentOff";
  return null;
}

export interface Recipient { personaId: string; name: string; via: "mention" | "reply" | "target" }
/** 这条消息会交给谁(与服务端优先级一致:@ai 别名 > @名字 > 回复规则 > to;spec §3.4)。只用于提示。 */
export function recipientOf(p: { draft: string; quote: RoomMessage | null; agents: readonly RoomAgent[]; to: string | null }): Recipient | null {
  const find = (id: string | null | undefined, via: Recipient["via"]): Recipient | null => {
    const a = p.agents.find((x) => x.id === id);
    return a ? { personaId: a.id, name: a.name, via } : null;
  };
  if (mentionsAi(p.draft).ai) return find(p.agents[0]?.id, "mention");
  const named = mentionsAgent(p.draft, p.agents.map((a) => a.name)).index;
  if (named !== null) return find(p.agents[named]?.id, "mention");
  const replied = p.quote ? agentOf(p.quote) : null;
  if (replied) return find(replied.agent.personaId, "reply") ?? { personaId: replied.agent.personaId, name: replied.agent.name, via: "reply" };
  return find(p.to, "target");
}

/** 带练正在等我回答(R-AW3:这时不带 to / to_agent)。 */
export const myTutorTurn = (tutor: RoomTutorInfo | null, meId: number | null): boolean =>
  !!tutor && tutor.phase === "await_answer" && meId !== null && tutor.currentUserId === meId;
