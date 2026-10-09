import { request } from "./client";
import type { AdminSession } from "./session";
import type {
  AssessmentDetail,
  AssessmentItem,
  ConversationItem,
  ConversationMessages,
  Overview,
  Page,
  SessionWire,
  PracticeItem,
  SourceFilter,
  UserDetail,
  UsersPage,
  VocabularyItem,
} from "./types";

export const PER_PAGE = 20;

const paged = (page: number) => ({ page, per_page: PER_PAGE });
const enc = encodeURIComponent;

export type LoginResult = AdminSession & { mfaRequired: boolean };

export function toSession(w: SessionWire): LoginResult {
  return {
    username: w.username,
    role: w.role,
    csrfToken: w.csrf_token,
    expiresAt: w.expires_at,
    stepUpUntil: w.step_up_until,
    totpEnabled: w.totp_enabled,
    safeMode: w.safe_mode,
    maintenanceMode: w.maintenance_mode,
    mfaRequired: w.mfa_required,
  };
}

/** 第一步:账号密码。`mfaRequired` 为 true 时还要 `loginTotp`。 */
export const login = async (username: string, password: string) =>
  toSession(await request<SessionWire>("/api/admin/login", { json: { username, password }, auth: false }));

/** 第二步:TOTP 验证码或一次性恢复码(请求带第一步返回的 CSRF)。 */
export const loginTotp = async (code: string) =>
  toSession(await request<SessionWire>("/api/admin/login/totp", { json: { code }, auth: false }));

/** 当前 Cookie 会话;没有会话时 401(调用方据此跳登录)。 */
export const getSession = async (): Promise<AdminSession> => {
  const { mfaRequired: _ignored, ...session } = toSession(await request<SessionWire>("/api/admin/session", { auth: false }));
  return session;
};

export const logout = () => request<void>("/api/admin/logout", { method: "POST", as: "none", auth: false });

/** 二次验证:重新输入密码(已绑定 TOTP 时加验证码);成功后危险操作在有效期内放行。 */
export const stepUp = (password: string, code?: string) =>
  request<{ step_up_until: string }>("/api/admin/step-up", { json: { password, code: code || undefined }, auth: false });

export const getOverview = (days: number) => request<Overview>("/api/admin/overview", { query: { days } });

export const listUsers = (q: string, page: number) =>
  request<UsersPage>("/api/admin/users", { query: { q: q.trim() || undefined, ...paged(page) } });

export const getUser = (id: string) => request<UserDetail>(`/api/admin/users/${enc(id)}`);

export const listConversations = (userId: string, page: number) =>
  request<Page & { conversations: ConversationItem[] }>(`/api/admin/users/${enc(userId)}/conversations`, { query: paged(page) });

export const getConversation = (id: string) => request<ConversationMessages>(`/api/admin/conversations/${enc(id)}/messages`);

export const listUserAssessments = (userId: string, source: SourceFilter, page: number) =>
  request<Page & { assessments: AssessmentItem[] }>(`/api/admin/users/${enc(userId)}/assessments`, { query: { source, ...paged(page) } });

export const listAssessments = (source: SourceFilter, page: number) =>
  request<Page & { assessments: AssessmentItem[] }>("/api/admin/assessments", { query: { source, ...paged(page) } });

export const getAssessment = (id: string) => request<AssessmentDetail>(`/api/admin/assessments/${enc(id)}`);

/** 录音走 Cookie 会话;取 blob 再转 object URL,便于统一处理错误与取消。 */
export const fetchAudio = (id: string, signal?: AbortSignal) =>
  request<Blob>(`/api/admin/assessments/${enc(id)}/audio`, { as: "blob", signal });

export const listPracticeItems = (userId: string, page: number) =>
  request<Page & { items: PracticeItem[] }>(`/api/admin/users/${enc(userId)}/practice-items`, { query: paged(page) });

export const listVocabulary = (userId: string, page: number) =>
  request<Page & { items: VocabularyItem[] }>(`/api/admin/users/${enc(userId)}/vocabulary`, { query: paged(page) });
