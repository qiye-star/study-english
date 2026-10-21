import { ApiError, type ApiClient } from "~/api/client";

/**
 * 配音的 HTTP 层(计划 L5 R24 契约夹具 `server/tests/fixtures/dubbing_contract.json`)。
 * 客户端会把请求体键 decamelize、把回包键 camelize,所以这里一律用驼峰类型。
 * 只有 uuid 与整数进 URL;句子文字、角色名与评测文字从不进 URL 或日志。
 */

export const ROLE_KEYS = ["A", "B", "C", "D", "E", "F"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface DubbingLimits {
  maxLines: number;
  maxMs: number;
  windowBeforeMs: number;
  windowAfterMs: number;
  syncToleranceMs: number;
  weights: { pronunciation: number; fluency: number; sync: number };
  maxRoles: number;
}

export interface DubbingConfig {
  enabled: boolean;
  /** 角色建议(LLM)是否可用:需要配音开关与跟读库的 AI 都开着 */
  suggest: boolean;
  limits: DubbingLimits | null;
}

/** 开关关闭(含旧服务端 404)时的占位配置;网页只据此隐藏入口。 */
export const DUBBING_DISABLED: DubbingConfig = Object.freeze({ enabled: false, suggest: false, limits: null });

export interface RoleName { key: RoleKey; name: string }
export interface SpeakerEntry { idx: number; speaker: RoleKey | null }
export interface RolesState {
  names: RoleName[];
  speakers: SpeakerEntry[];
  editable: boolean;
  /** 精选副本的角色由管理员设定,对用户只读;`locked` 说明原因 */
  locked: "catalog" | null;
}
export interface RolesPatch {
  names?: Partial<Record<RoleKey, string | null>>;
  speakers?: SpeakerEntry[];
}
export interface SuggestResult { speakers: SpeakerEntry[] }

export type TakeStatus = "recording" | "done";
export type SyncBasis = "words" | "duration" | "none";
export interface TakeSummary { pronunciation: number; fluency: number; sync: number | null }

export interface TakeLineScored {
  segIdx: number;
  assessmentId: string;
  pronunciation: number;
  fluency: number;
  sync: number | null;
  syncBasis: SyncBasis;
  score: number;
  onsetMs: number | null;
  ratioPct: number | null;
  stale: boolean;
}
export interface TakeLineMissing {
  segIdx: number;
  missing: true;
  reason: string;
  stale: boolean;
}
export type TakeLine = TakeLineScored | TakeLineMissing;

export interface DubbingTake {
  id: string;
  itemId: string;
  segFrom: number;
  segTo: number;
  role: RoleKey;
  status: TakeStatus;
  /** 片段内属于该角色的句子下标 */
  expected: number[];
  totalScore: number | null;
  summary: TakeSummary | null;
  lines: TakeLine[];
  createdAt: string;
  finishedAt: string | null;
}

export interface LineResult {
  segIdx: number;
  pronunciation: number;
  fluency: number;
  sync: number | null;
  syncBasis: SyncBasis;
  score: number;
}

export interface LineInput {
  segIdx: number;
  /** 本句的评测编号(`POST /api/speech/assessments` 返回的 assessment_id) */
  assessmentId: string;
  /** 录音窗口开始时的媒体毫秒(相对视频) */
  recStartMs: number;
  /** 能量门限测得的有声毫秒;没有则 null */
  voicedMs: number | null;
  capture: "pcm" | "recorder";
}

/** 服务端固定英文错误文本 → 文案键(契约夹具 `errors`;顺序与夹具一致)。 */
export const DUBBING_SERVER_ERRORS: Record<string, string> = {
  "Dubbing is disabled": "web.dubbing.errors.disabled",
  "Not Found": "web.dubbing.errors.notFound",
  "Item is not ready": "web.dubbing.errors.notReady",
  "Roles are set by the editors": "web.dubbing.errors.rolesLocked",
  "Invalid roles": "web.dubbing.errors.badRoles",
  "Invalid clip": "web.dubbing.errors.badClip",
  "Clip is too long": "web.dubbing.errors.clipTooLong",
  "Role has no lines in the clip": "web.dubbing.errors.roleMissing",
  "Take is finished": "web.dubbing.errors.takeDone",
  "Line is not in the take": "web.dubbing.errors.lineNotInTake",
  "Line already recorded": "web.dubbing.errors.lineDone",
  "Assessment does not match the line": "web.dubbing.errors.assessment",
  "Invalid line timing": "web.dubbing.errors.timing",
  "AI is unavailable": "web.dubbing.errors.aiUnavailable",
  "Daily AI limit reached": "web.dubbing.errors.aiUserCap",
  "AI is busy today": "web.dubbing.errors.aiGlobalCap",
};

const BASE = "/api/dubbing";
const itemPath = (id: string, tail: string) => `${BASE}/items/${encodeURIComponent(id)}${tail}`;
const takePath = (dubId: string, tail = "") => `${BASE}/takes/${encodeURIComponent(dubId)}${tail}`;

/** 404 = 没装配音的旧服务端,按关闭处理;其他错误照抛(由调用方决定)。 */
export async function fetchDubbingConfig(api: ApiClient): Promise<DubbingConfig> {
  try {
    const c = await api.request<Partial<DubbingConfig>>("GET", `${BASE}/config`);
    return { enabled: c.enabled === true, suggest: c.suggest === true, limits: c.limits ?? null };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return DUBBING_DISABLED;
    throw err;
  }
}

export function getRoles(api: ApiClient, itemId: string, signal?: AbortSignal): Promise<RolesState> {
  return api.request<RolesState>("GET", itemPath(itemId, "/roles"), { signal });
}

export function putRoles(api: ApiClient, itemId: string, patch: RolesPatch): Promise<RolesState> {
  return api.request<RolesState>("PUT", itemPath(itemId, "/roles"), { json: patch });
}

/** 一个片段一次调用;只返回草稿,不写库(用户确认后再 PUT)。 */
export async function suggestRoles(api: ApiClient, itemId: string, clip: { segFrom: number; segTo: number }): Promise<SuggestResult> {
  return api.request<SuggestResult>("POST", itemPath(itemId, "/roles/suggest"), { json: clip });
}

export async function createTake(api: ApiClient, itemId: string, input: { segFrom: number; segTo: number; role: RoleKey }): Promise<DubbingTake> {
  return (await api.request<{ take: DubbingTake }>("POST", itemPath(itemId, "/takes"), { json: input })).take;
}

export async function listTakes(api: ApiClient, itemId: string, signal?: AbortSignal): Promise<DubbingTake[]> {
  return (await api.request<{ takes: DubbingTake[] }>("GET", itemPath(itemId, "/takes"), { signal })).takes;
}

export async function getTake(api: ApiClient, dubId: string, signal?: AbortSignal): Promise<DubbingTake> {
  return (await api.request<{ take: DubbingTake }>("GET", takePath(dubId), { signal })).take;
}

export async function deleteTake(api: ApiClient, dubId: string): Promise<void> {
  await api.request("DELETE", takePath(dubId));
}

export async function postLine(api: ApiClient, dubId: string, line: LineInput, signal?: AbortSignal): Promise<LineResult> {
  return (await api.request<{ line: LineResult }>("POST", takePath(dubId, "/lines"), { json: line, signal })).line;
}

export async function finishTake(api: ApiClient, dubId: string): Promise<DubbingTake> {
  return (await api.request<{ take: DubbingTake }>("POST", takePath(dubId, "/finish"))).take;
}

/** 按状态码判断,不按文本(文本可能随服务端改动)。 */
export function isDubbingNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

export function isAiLimited(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

export function isAiUnavailable(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}
