import { request } from "../../api/client";

/* ---- 规则文档:与服务端 rules_json 完全一致(snake_case,原样回传) ---- */

export interface TierRule {
  key: string;
  division_rp: number;
}

export interface PointsRule {
  /** [分数下限, 点数],按下限降序,末档下限为 0 */
  assessment_bands: [number, number][];
  chat_turn: number;
  vocab_review: number;
  active_day: number;
  streak_7: number;
  stage_task: number;
  daily_cap: number;
}

export type StageKind = "assess" | "chat_turns" | "voice_turns" | "vocab_reviews" | "active_days";

export interface StageTaskRule {
  key: string;
  kind: StageKind;
  target: number;
  min_score: number | null;
}

export interface MatchRule {
  /** 目标段位 "1"–"6" → 用户发言轮数 */
  turns: Record<string, number>;
  /** 目标段位 "1"–"6" → 通过线 */
  thresholds: Record<string, number>;
  llm_weights: Record<string, number>;
  speech_weight: number;
  borderline: number;
  gate_task_min: number;
  gate_english_ratio: number;
  min_seconds: number;
  max_seconds: number;
  daily_attempts: number;
  cooldown_minutes: number;
  match_minutes: number;
  fail_keep: number;
  examiner_prompt: string;
  judge_prompt: string;
}

export interface SeasonRule {
  anchor: string;
  weeks: number;
}

export interface ScenarioRule {
  key: string;
  target_tier: number;
  title_zh: string;
  title_en: string;
  brief_zh: string;
  role: string;
  setting: string;
  functions: string[];
  opener: string;
  enabled: boolean;
}

export interface RankRules {
  tiers: TierRule[];
  points: PointsRule;
  stage_tasks: Record<string, StageTaskRule[]>;
  match: MatchRule;
  season: SeasonRule;
  scenarios: ScenarioRule[];
}

/* ---- 其余响应:转为 camelCase ---- */

export interface PublishedRules {
  version: number;
  rules: RankRules;
  publishedAt: string | null;
  publishedBy: string | null;
  note?: string;
}

export interface DraftRules {
  rules: RankRules;
  note: string;
  basedOn: number | null;
  updatedBy: string;
  updatedAt: string | null;
  /** 草稿内容标识;发布时带上审阅时看到的这个值,服务端草稿已变则 409 Draft changed */
  etag: string;
}

export interface VersionItem {
  version: number;
  publishedAt: string | null;
  publishedBy: string | null;
  note: string;
}

export interface RulesOverview {
  published: PublishedRules | null;
  /** 未发布任何版本时:由 .env 推出的 v0 */
  v0?: RankRules | null;
  draft: DraftRules | null;
  versions: VersionItem[];
  /** 第 1 赛季已开始:赛季配置只读 */
  seasonStarted?: boolean;
}

export interface VersionDetail {
  version: number;
  status: string;
  rules: RankRules;
  note: string;
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface Pair {
  current: number;
  draft: number;
}

/** POST /rank/rules/draft/simulate(spec §5.3) */
export interface Impact {
  profiles: number;
  gate: Pair;
  clamped: number;
  stageComplete: Pair;
  dailyCap: {
    userDays: number;
    cappedCurrent: number;
    cappedDraft: number;
    avgPointsCurrent: number;
    avgPointsDraft: number;
  };
  verdicts: { matches: number; passToFail: number; failToPass: number };
  scenarioPool: Record<string, number>;
  scenarioPoolCurrent?: Record<string, number>;
  removedInUse?: string[];
  paceDays: Record<string, [number, number]>;
  paceDaysCurrent?: Record<string, [number, number]>;
}

export interface RankOverview {
  tiers: { key: string; users: number }[];
  profiles: number;
  matches7d: { passed: number; failed: number; gradingFailed: number; voided: number };
  activeMatches: number;
  cooldownUsers: number;
  resetConfirm: string;
  lastReset: { batchId: string; at: string; users: number; undoUntil: string } | null;
}

export type MatchStatus = "active" | "grading_failed" | "passed" | "failed" | "expired" | "abandoned" | "voided";

export interface MatchRow {
  id: string;
  userId: number;
  status: MatchStatus;
  fromTier: string;
  toTier: string;
  scenarioKey: string;
  scenarioTitleZh: string;
  total: number | null;
  threshold: number;
  attemptNo: number;
  rulesVersion: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  gatesFailed: string[];
}

export interface MatchTurn {
  role: "ai" | "user";
  text: string;
  pron?: number | null;
  fluency?: number | null;
  english?: boolean | null;
  echo?: boolean | null;
  short?: boolean | null;
  durationMs?: number | null;
}

export interface MatchResult {
  passed?: boolean;
  total?: number;
  threshold?: number;
  dimensions?: Record<string, number | null>;
  speechAvailable?: boolean;
  gatesFailed?: string[];
  functionsMet?: string[];
  strengthsZh?: string[];
  improveZh?: string[];
  drillEn?: string;
}

export interface MatchDetail {
  match: MatchRow & { turnLimit: number; expiresAt: string | null; gradeAttempts: number; turns: MatchTurn[] };
  scenario: { key: string; titleZh: string; titleEn: string; briefZh: string; role: string; setting: string; functions: string[] };
  result: MatchResult | null;
  userId: number;
}

export interface UserRankProfile {
  tier: number;
  tierKey: string;
  division: number;
  rp: number;
  divisionRp: number;
  stars: number;
  bestTier: number;
  bestTierKey: string;
  tierStartedAt: string | null;
  cooldownUntil: string | null;
  atGate: boolean;
}

export interface StageTaskProgress {
  key: string;
  kind: StageKind;
  done: number;
  target: number;
  minScore: number | null;
  complete: boolean;
}

export interface RankEvent {
  kind: string;
  points: number;
  day: string;
  tier: number;
  createdAt: string | null;
  actor?: string | null;
  reason?: string | null;
}

export interface AchievementItem {
  key: string;
  group: string;
  icon: string;
  unlockedAt: string | null;
}

export interface UserRank {
  profile: UserRankProfile | null;
  stageTasks: StageTaskProgress[];
  promotion: { state: string; reason: string | null; cooldownUntil: string | null; attemptsLeft: number; targetTier: string | null } | null;
  attemptsToday: { day: string; used: number; limit: number; left: number };
  quotaOverride: number | null;
  /** 每个段位的每小段点数(当前生效规则),用于定级时的点数上限 */
  divisionRps?: number[];
  recentEvents: RankEvent[];
  matches: MatchRow[];
  achievements: AchievementItem[];
}

/** 规则文档(rules / v0)保持原样;其余键转 camelCase。 */
const RAW_KEYS = new Set(["rules", "v0"]);

function camelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function camelize<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camelize(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[camelKey(k)] = RAW_KEYS.has(k) ? v : camelize(v);
    }
    return out as T;
  }
  return value as T;
}

async function get<T>(path: string, query?: Record<string, string | number | undefined | null>): Promise<T> {
  return camelize<T>(await request(path, { query }));
}

async function post<T>(path: string, json: unknown = {}): Promise<T> {
  return camelize<T>(await request(path, { method: "POST", json }));
}

/* ---- 规则 ---- */
export const getRules = () => get<RulesOverview>("/api/admin/rank/rules");
export const getVersion = (v: number) => get<VersionDetail>(`/api/admin/rank/rules/versions/${v}`);
export const createDraft = (fromVersion?: number | null) =>
  post<{ rules: RankRules; note: string; etag: string }>("/api/admin/rank/rules/draft", { from_version: fromVersion ?? null });
export const saveDraft = (rules: RankRules, note: string) =>
  request<{ rules: RankRules; note: string; etag: string }>("/api/admin/rank/rules/draft", { method: "PUT", json: { rules, note } });
export const deleteDraft = () => request<void>("/api/admin/rank/rules/draft", { method: "DELETE" });
export const validateDraft = () => post<{ errors: string[] }>("/api/admin/rank/rules/draft/validate");
export const simulateDraft = () => post<Impact>("/api/admin/rank/rules/draft/simulate");
export const publishDraft = (reason: string, draftEtag: string) =>
  post<{ version: number }>("/api/admin/rank/rules/draft/publish", { reason, draft_etag: draftEtag });

/* ---- 概览与全体操作 ---- */
export const getRankOverview = () => get<RankOverview>("/api/admin/rank/overview");
export const clearAllCooldowns = (reason: string) => post<{ users: number }>("/api/admin/rank/clear-cooldowns", { reason });
export const resetAll = (reason: string, confirm: string) =>
  post<{ batchId: string; users: number }>("/api/admin/rank/reset-all", { reason, confirm });
export const undoReset = (batchId: string) => post<{ users: number; skipped: number }>(`/api/admin/rank/reset-all/${encodeURIComponent(batchId)}/undo`);

/* ---- 单个用户 ---- */
const userPath = (id: number) => `/api/admin/users/${id}/rank`;
export const getUserRank = (id: number) => get<UserRank>(userPath(id));
export const clearCooldown = (id: number) => request<void>(`${userPath(id)}/clear-cooldown`, { method: "POST", json: {} });
export const resetAttempts = (id: number, day: string) => post<{ deleted: number }>(`${userPath(id)}/reset-attempts`, { day });
export const adjustPoints = (id: number, delta: number, reason: string) =>
  post<UserRankProfile>(`${userPath(id)}/adjust`, { delta, reason });
export const setAchievement = (id: number, key: string, granted: boolean) =>
  request<void>(`${userPath(id)}/achievement`, { method: "POST", json: { key, granted } });
export const resetUserRank = (id: number, body: { tier: number; division: number; rp: number; reason: string }) =>
  post<{ batchId: string }>(`${userPath(id)}/reset`, body);

/* ---- 比赛 ---- */
export const listMatches = (q: { userId?: number | null; status?: string | null; page?: number }) =>
  get<{ items: MatchRow[]; page: number; next: number | null }>("/api/admin/rank/matches", {
    user_id: q.userId ?? undefined,
    status: q.status ?? undefined,
    page: q.page ?? 1,
  });
export const getMatch = (id: string) => get<MatchDetail>(`/api/admin/rank/matches/${encodeURIComponent(id)}`);
export const voidMatch = (id: string, reason: string) =>
  post<MatchRow & { restored: boolean }>(`/api/admin/rank/matches/${encodeURIComponent(id)}/void`, { reason });
export const regradeMatch = (id: string) =>
  post<{ status: MatchStatus; total: number | null; newTier: string }>(`/api/admin/rank/matches/${encodeURIComponent(id)}/regrade`);
