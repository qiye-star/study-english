import { TUTOR_KINDS, TUTOR_VERDICTS, type TutorKind, type TutorMeta, type TutorRecap, type TutorSession, type TutorVerdict } from "./tutor-api";

const pick = (o: Record<string, unknown>, snake: string, camel: string): unknown => (snake in o ? o[snake] : o[camel]);

/** 回合流里的 `meta` 数据(snake / camel 都接受;服务端省略 null 键);形状不对返回 null。 */
export function parseTutorMeta(raw: unknown): TutorMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const step = pick(o, "step_index", "stepIndex");
  const total = pick(o, "steps_total", "stepsTotal");
  if (typeof step !== "number" || typeof total !== "number") return null;
  return {
    stepIndex: step, stepsTotal: total,
    verdict: TUTOR_VERDICTS.includes(o.verdict as TutorVerdict) ? (o.verdict as TutorVerdict) : null,
    kind: TUTOR_KINDS.includes(o.kind as TutorKind) ? (o.kind as TutorKind) : null,
    done: o.done === true, retry: o.retry === true,
    say: typeof o.say === "string" && o.say ? o.say : null,
  };
}

/** 服务端已推进状态机;这里只把同样的结果放进本地会话,省一次 GET。 */
export function applyMeta(s: TutorSession, m: TutorMeta): TutorSession {
  const record = m.verdict !== null && !m.retry && s.phase === "await_answer";
  return {
    ...s,
    phase: m.done ? "wrap_up" : "await_answer",
    stepIndex: m.stepIndex, stepsTotal: m.stepsTotal, kind: m.done ? null : m.kind, say: m.say,
    hintsUsed: m.retry ? s.hintsUsed : 0,
    answers: record ? [...s.answers, { index: s.stepIndex - 1, kind: s.kind ?? "ask", verdict: m.verdict! }] : s.answers,
  };
}

export interface ScoreBar { verdict: TutorVerdict; count: number; pct: number }
export function scoreBars(recap: TutorRecap): ScoreBar[] {
  const total = TUTOR_VERDICTS.reduce((n, v) => n + (recap.scores[v] ?? 0), 0);
  return TUTOR_VERDICTS.map((v) => {
    const count = recap.scores[v] ?? 0;
    return { verdict: v, count, pct: total ? Math.round((count / total) * 100) : 0 };
  });
}

export const isActive = (s: TutorSession | null): s is TutorSession => !!s && s.status === "active" && s.phase !== "done";
/** 智能体要先开口(开场 / 跳过后出题):对话页发一个 text = null 的导师回合。 */
export const needsAgentTurn = (s: TutorSession | null): boolean => isActive(s) && (s.phase === "opening" || s.phase === "ask");
