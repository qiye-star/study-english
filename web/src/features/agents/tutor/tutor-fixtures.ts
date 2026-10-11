import camelcaseKeys from "camelcase-keys";
import type { TutorSession } from "./tutor-api";

export const SID = "11111111-1111-4111-8111-111111111111";
export const CID = "33333333-3333-4333-8333-333333333333";
export const RAW_RECAP = {
  total: 5, answered: 4, skipped: 1, scores: { good: 2, ok: 1, weak: 1, skip: 1 },
  strengths: [{ kind: "words", focus: "today_words" }], weaknesses: [{ kind: "dictate", focus: "today_words" }],
  words: ["abandon", "resilient"], level_start: "B1", level_end: "B2", topic: "today_words",
};

/** 服务端原样(snake_case)的会话,用于 fetch mock。 */
export function rawSession(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SID, conversation_id: CID, persona_id: "builtin:coach", status: "active", phase: "await_answer", step_index: 2,
    steps_total: 5, level: "B1", kind: "words", hints_used: 0, hints_max: 2,
    goal: { topic: "today_words", scenario: null, length: 5, input: "text", mix: ["ask", "words", "repeat", "retell", "roleplay", "dictate"] },
    answers: [{ index: 0, kind: "ask", verdict: "good" }], say: null, recap: null, resumed: false,
    created_at: "2026-10-12T00:00:00+00:00", updated_at: "2026-10-12T00:00:00+00:00", ...over,
  };
}

export const toSession = (raw: Record<string, unknown>) => camelcaseKeys(raw, { deep: true }) as unknown as TutorSession;
