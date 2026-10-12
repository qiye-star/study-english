import type { RoomMessage } from "../protocol";

/** 公共智能体回复的 meta(服务端 R-RA2;经 camelcase-keys 后的形状)。 */
export interface AgentRef { personaId: string; name: string }
export interface AgentTutorMeta {
  stepIndex: number; stepsTotal: number; toUserId: number | null; toName: string | null; final: boolean;
  verdictFor: number | null; verdict: "good" | "ok" | "weak" | "skip" | null;
}
/** 中文说明的上限(与服务端 note_zh ≤ 80 字一致,spec addressing §5.1)。 */
export const NOTE_ZH_MAX = 80;
const note = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? Array.from(s).slice(0, NOTE_ZH_MAX).join("") : null;
};
export interface AgentAnswerMeta {
  agent: AgentRef; asker: { id: number; name: string } | null; handoffFrom: AgentRef | null; tutor: AgentTutorMeta | null;
  /** 公开消息 meta.note_zh(经 camelcase-keys);不朗读,界面折叠显示 */
  noteZh: string | null;
}

const ref = (v: unknown): AgentRef | null => {
  const r = v as Partial<AgentRef> | null | undefined;
  return r && typeof r.personaId === "string" && typeof r.name === "string" ? { personaId: r.personaId, name: r.name } : null;
};

/** 智能体回复 → 角色、提问者、接力来源、带练信息;普通 @ai 回复(meta 为空)与隐藏的消息返回 null。 */
export function agentOf(m: RoomMessage): AgentAnswerMeta | null {
  if (m.kind !== "ai_answer" || m.hidden || !m.meta) return null;
  const agent = ref(m.meta.agent);
  if (!agent) return null;
  const asker = m.meta.asker as { id?: unknown; name?: unknown } | undefined;
  const tutor = m.meta.tutor as AgentTutorMeta | undefined;
  return {
    agent,
    asker: asker && typeof asker.id === "number" && typeof asker.name === "string" ? { id: asker.id, name: asker.name } : null,
    handoffFrom: ref(m.meta.handoffFrom),
    tutor: tutor && typeof tutor.stepIndex === "number" ? tutor : null,
    noteZh: note(m.meta.noteZh),
  };
}
