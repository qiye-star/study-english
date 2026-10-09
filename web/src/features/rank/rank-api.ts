import type { ApiClient } from "~/api/client";

export type TierKey = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "star" | "master";
export interface TierInfo { key: TierKey; index: number; cefr: string; divisions: number; divisionRp: number }
export interface SeasonInfo { id: number; startsOn: string; endsOn: string }
export interface RankConfig { enabled: boolean; matchAvailable: boolean; tiers: TierInfo[]; season: SeasonInfo | null }

export function fetchRankConfig(api: ApiClient, signal?: AbortSignal): Promise<RankConfig> {
  return api.request<RankConfig>("GET", "/api/rank/config", { signal });
}

export type StageTaskKind = "assess" | "chat_turns" | "voice_turns" | "vocab_reviews" | "active_days";
export interface StageTask { key: string; kind: StageTaskKind; done: number; target: number; minScore: number | null; complete: boolean }
export type PromotionState = "locked" | "eligible" | "cooldown" | "no_attempts" | "max_tier" | "unavailable";
export interface PromotionStatus { state: PromotionState; reason: "rp" | "tasks" | null; cooldownUntil: string | null; attemptsLeft: number; targetTier: TierKey | null }
export interface RpEvent { kind: string; points: number; day: string; createdAt: string }
export interface RankMe {
  tier: TierKey; tierIndex: number; division: number; rp: number; divisionRp: number; stars: number;
  stageTasks: StageTask[]; promotion: PromotionStatus; season: SeasonInfo | null; seasonRp: number;
  recentEvents: RpEvent[]; newAchievements: string[]; activeMatchId: string | null;
}
export interface AchievementItem { key: string; group: string; icon: string; unlockedAt: string | null }
export interface MatchTurn { role: "ai" | "user"; text: string }
export interface MatchScenario { key: string; titleZh: string; titleEn: string; briefZh: string; functions: string[] }
export type MatchStatus = "active" | "passed" | "failed" | "expired" | "abandoned" | "grading_failed";
export interface Match {
  id: string; status: MatchStatus; fromTier: TierKey; toTier: TierKey; scenario: MatchScenario; turnLimit: number;
  turns: MatchTurn[]; attemptNo: number; startedAt: string; expiresAt: string; finishedAt: string | null;
}
export interface TurnResult { turnIndex: number; transcript: string; aiLine: string | null; done: boolean }
export interface Verdict {
  passed: boolean; total: number; threshold: number;
  dimensions: { task: number; accuracy: number; range: number; interaction: number; speech: number | null };
  speechAvailable: boolean; gatesFailed: string[]; functionsMet: string[]; strengthsZh: string[]; improveZh: string[];
  drillEn: string; newTier: TierKey | null; cooldownUntil: string | null;
}

/** 服务端错误原文 → i18n 键(server/app/routers/rank.py 的 MATCH_ERRORS)。 */
export const RANK_SERVER_ERRORS: Record<string, string> = {
  "Not eligible": "web.rank.errors.notEligible",
  Cooldown: "web.rank.errors.cooldown",
  "No attempts left": "web.rank.errors.noAttempts",
  "Match in progress": "web.rank.errors.inProgress",
  "Promotion matches are not available": "web.rank.errors.unavailable",
  "Daily match limit reached": "web.rank.errors.dailyLimit",
  "Match expired": "web.rank.errors.expired",
  "Match is not active": "web.rank.errors.notActive",
  "Match is not finished": "web.rank.errors.notActive",
  "Expected 16 kHz mono WAV": "web.rank.errors.badAudio",
  "Audio too short": "web.rank.errors.tooShort",
  "Audio too long": "web.rank.errors.tooLong",
  "Upstream unavailable": "web.rank.errors.upstream",
  "Grading failed": "web.rank.errors.grading",
  "Match not found": "web.rank.errors.notFound",
  "Rank is disabled": "web.rank.disabled",
};

/** 本地时区相对 UTC 的分钟数(东八区 = 480),服务端据此算"今天"。 */
export const localOffsetMinutes = () => -new Date().getTimezoneOffset();

export function fetchRankMe(api: ApiClient, tz = localOffsetMinutes(), signal?: AbortSignal): Promise<RankMe> {
  return api.request<RankMe>("GET", "/api/rank/me", { query: { tz_offset_minutes: tz }, signal });
}

export async function fetchAchievements(api: ApiClient, signal?: AbortSignal): Promise<AchievementItem[]> {
  return (await api.request<{ achievements: AchievementItem[] }>("GET", "/api/rank/achievements", { signal })).achievements;
}

export async function startMatch(api: ApiClient, tz = localOffsetMinutes()): Promise<Match> {
  return (await api.request<{ match: Match }>("POST", "/api/rank/matches", { query: { tz_offset_minutes: tz } })).match;
}

export function getMatch(api: ApiClient, id: string, signal?: AbortSignal): Promise<{ match: Match; verdict: Verdict | null }> {
  return api.request("GET", `/api/rank/matches/${encodeURIComponent(id)}`, { signal });
}

export function sendTurn(api: ApiClient, id: string, wav: Blob, signal?: AbortSignal): Promise<TurnResult> {
  const form = new FormData();
  form.append("file", wav, "turn.wav");
  return api.request<TurnResult>("POST", `/api/rank/matches/${encodeURIComponent(id)}/turns`, { form, signal, timeoutMs: 90_000 });
}

export function finishMatch(api: ApiClient, id: string): Promise<{ match: Match; verdict: Verdict }> {
  return api.request("POST", `/api/rank/matches/${encodeURIComponent(id)}/finish`, { timeoutMs: 120_000 });
}

export async function abandonMatch(api: ApiClient, id: string): Promise<Match> {
  return (await api.request<{ match: Match }>("POST", `/api/rank/matches/${encodeURIComponent(id)}/abandon`)).match;
}
