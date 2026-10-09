import type { Match, TurnResult, Verdict } from "./rank-api";
import { userTurns } from "./tiers";

export type MatchPhase = "loading" | "briefing" | "ai_speaking" | "your_turn" | "recording" | "uploading" | "grading" | "result" | "error";
export type RetryStep = "load" | "turn" | "finish";
export interface MatchState { phase: MatchPhase; match: Match | null; verdict: Verdict | null; error: string | null; retry: RetryStep | null; showText: boolean }
export type MatchEvent =
  | { type: "loaded"; match: Match; verdict: Verdict | null }
  | { type: "begin" } | { type: "ai_done" } | { type: "press" } | { type: "cancel" } | { type: "release" }
  | { type: "turn_ok"; result: TurnResult }
  | { type: "finished"; match: Match; verdict: Verdict }
  | { type: "failed"; error: string; retry: RetryStep }
  | { type: "retry" } | { type: "toggle_text" }
  | { type: "ended"; match: Match };

export const initialMatchState = (): MatchState => ({ phase: "loading", match: null, verdict: null, error: null, retry: null, showText: false });

export function lastAiLine(match: Match): string {
  for (let i = match.turns.length - 1; i >= 0; i -= 1) if (match.turns[i].role === "ai") return match.turns[i].text;
  return "";
}

/** 断点续赛:按服务端的场次状态与已说轮数决定从哪一步继续。 */
function phaseFor(match: Match, verdict: Verdict | null): MatchPhase {
  if (match.status === "grading_failed") return "grading";
  if (match.status !== "active" || verdict) return "result";
  const done = userTurns(match);
  if (done >= match.turnLimit) return "grading";
  return done === 0 ? "briefing" : "your_turn";
}

/** 纯状态机(spec §10.2)。不适用的事件原样返回同一个对象,方便调用方忽略。 */
export function matchReducer(s: MatchState, e: MatchEvent): MatchState {
  switch (e.type) {
    case "loaded":
      return { ...s, match: e.match, verdict: e.verdict, phase: phaseFor(e.match, e.verdict), error: null, retry: null };
    case "begin":
      return s.phase === "briefing" ? { ...s, phase: "ai_speaking" } : s;
    case "ai_done":
      return s.phase === "ai_speaking" ? { ...s, phase: "your_turn" } : s;
    case "press":
      return s.phase === "your_turn" ? { ...s, phase: "recording" } : s;
    case "cancel":
      return s.phase === "recording" ? { ...s, phase: "your_turn" } : s;
    case "release":
      return s.phase === "recording" ? { ...s, phase: "uploading" } : s;
    case "turn_ok": {
      if (s.phase !== "uploading" || !s.match) return s;
      const turns = [...s.match.turns, { role: "user" as const, text: e.result.transcript },
        ...(e.result.aiLine ? [{ role: "ai" as const, text: e.result.aiLine }] : [])];
      return { ...s, match: { ...s.match, turns }, phase: e.result.done ? "grading" : "ai_speaking" };
    }
    case "finished":
      return { ...s, match: e.match, verdict: e.verdict, phase: "result", error: null, retry: null };
    case "ended":
      return { ...s, match: e.match, phase: "result", error: null, retry: null };
    case "failed":
      return { ...s, phase: "error", error: e.error, retry: e.retry };
    case "retry":
      if (s.phase !== "error") return s;
      return { ...s, error: null, phase: s.retry === "finish" ? "grading" : s.retry === "load" ? "loading" : "your_turn", retry: null };
    case "toggle_text":
      return { ...s, showText: !s.showText };
  }
}
