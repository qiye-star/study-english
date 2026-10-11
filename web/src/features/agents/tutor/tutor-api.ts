import type { ApiClient } from "~/api/client";

export const TUTOR_TOPICS = ["free", "scenario", "today_words", "weak_words"] as const;
export type TutorTopic = (typeof TUTOR_TOPICS)[number];
export const TUTOR_SCENARIOS = ["restaurant", "travel", "interview", "shopping", "small_talk"] as const;
export type TutorScenario = (typeof TUTOR_SCENARIOS)[number];
export const TUTOR_LENGTHS = [5, 8, 12] as const;
export type TutorInput = "text" | "voice";
export const TUTOR_KINDS = ["ask", "words", "repeat", "retell", "roleplay", "dictate"] as const;
export type TutorKind = (typeof TUTOR_KINDS)[number];
export const TUTOR_VERDICTS = ["good", "ok", "weak", "skip"] as const;
export type TutorVerdict = (typeof TUTOR_VERDICTS)[number];
export type TutorPhase = "opening" | "ask" | "await_answer" | "feedback" | "wrap_up" | "done";
export type TutorStatus = "active" | "done" | "expired";

export interface TutorGoal { topic: TutorTopic; scenario: TutorScenario | null; length: number; input: TutorInput; mix: TutorKind[] }
export interface TutorGoalInput { topic: TutorTopic; scenario: TutorScenario | null; length: number; input: TutorInput }
export interface TutorPoint { kind: TutorKind; focus: string }
export interface TutorRecap {
  total: number; answered: number; skipped: number; scores: Record<TutorVerdict, number>;
  strengths: TutorPoint[]; weaknesses: TutorPoint[]; words: string[]; levelStart: string; levelEnd: string; topic: TutorTopic | null;
}
export interface TutorAnswer { index: number; kind: TutorKind; verdict: TutorVerdict }
export interface TutorSession {
  id: string; conversationId: string | null; personaId: string; status: TutorStatus; phase: TutorPhase;
  stepIndex: number; stepsTotal: number; level: string; kind: TutorKind | null; hintsUsed: number; hintsMax: number;
  goal: TutorGoal; answers: TutorAnswer[]; say: string | null; recap: TutorRecap | null; resumed: boolean;
  createdAt: string; updatedAt: string;
}
export interface TutorHintResult { hint: string; session: TutorSession }
export interface TutorActive { session: TutorSession | null }
/** SSE `meta` 事件(spec §4.4 + R-T3):verdict 属于刚答的题,kind / say 属于现在等待的题;服务端省略 null 键,这里一律归一为 null。 */
export interface TutorMeta {
  stepIndex: number; stepsTotal: number; verdict: TutorVerdict | null; kind: TutorKind | null; done: boolean; retry: boolean; say: string | null;
}
export interface TutorStartInput extends TutorGoalInput { conversationId: string; personaId: string; clientStartId: string }

const BASE = "/api/agents/tutor";
export const getActiveTutor = (api: ApiClient, conversationId: string, signal?: AbortSignal) =>
  api.request<TutorActive>("GET", `${BASE}/active`, { query: { conversation_id: conversationId }, signal });
export const getTutor = (api: ApiClient, id: string, signal?: AbortSignal) => api.request<TutorSession>("GET", `${BASE}/${id}`, { signal });
export const startTutor = (api: ApiClient, input: TutorStartInput) => api.request<TutorSession>("POST", `${BASE}/start`, { json: input });
export const skipTutor = (api: ApiClient, id: string) => api.request<TutorSession>("POST", `${BASE}/${id}/skip`);
export const hintTutor = (api: ApiClient, id: string) => api.request<TutorHintResult>("POST", `${BASE}/${id}/hint`);
export const finishTutor = (api: ApiClient, id: string) => api.request<TutorSession>("POST", `${BASE}/${id}/finish`);

/** 服务端错误文案 → 文案键(translateServerError 的 extra)。 */
export const TUTOR_SERVER_ERRORS: Record<string, string> = {
  "Tutor is disabled": "web.agents.tutor.errors.disabled",
  "Daily tutor limit reached": "web.agents.tutor.errors.limit",
  "Tutor session is not waiting for an answer": "web.agents.tutor.errors.notWaiting",
  "Hint limit reached": "web.agents.tutor.errors.hintLimit",
  "Tutor session expired": "web.agents.tutor.errors.expired",
  "Tutor session finished": "web.agents.tutor.errors.finished",
  "Tutor session changed, reload": "web.agents.tutor.errors.changed",
  "Tutor session id reused": "web.agents.tutor.errors.changed",
  "Persona disabled": "web.agents.tutor.errors.personaDisabled",
};
