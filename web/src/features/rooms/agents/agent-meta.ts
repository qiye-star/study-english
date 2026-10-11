import type { RoomMessage } from "../protocol";

/** 公共智能体回复的 meta(服务端 R-RA2;经 camelcase-keys 后的形状)。 */
export interface AgentRef { personaId: string; name: string }
export interface AgentTutorMeta {
  stepIndex: number; stepsTotal: number; toUserId: number | null; toName: string | null; final: boolean;
  verdictFor: number | null; verdict: "good" | "ok" | "weak" | "skip" | null;
}
export interface AgentAnswerMeta { agent: AgentRef; asker: { id: number; name: string } | null; handoffFrom: AgentRef | null; tutor: AgentTutorMeta | null }

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
  };
}
