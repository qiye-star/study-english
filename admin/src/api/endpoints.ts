import { request } from "./client";
import type {
  AssessmentDetail,
  AssessmentItem,
  ConversationItem,
  ConversationMessages,
  LoginResponse,
  Overview,
  Page,
  PracticeItem,
  SourceFilter,
  UserDetail,
  UsersPage,
  VocabularyItem,
} from "./types";

export const PER_PAGE = 20;

const paged = (page: number) => ({ page, per_page: PER_PAGE });
const enc = encodeURIComponent;

export const login = (username: string, password: string) =>
  request<LoginResponse>("/api/admin/login", { json: { username, password }, auth: false });

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

/** <audio> 不能带请求头,所以取 blob 再转 object URL。 */
export const fetchAudio = (id: string, signal?: AbortSignal) =>
  request<Blob>(`/api/admin/assessments/${enc(id)}/audio`, { as: "blob", signal });

export const listPracticeItems = (userId: string, page: number) =>
  request<Page & { items: PracticeItem[] }>(`/api/admin/users/${enc(userId)}/practice-items`, { query: paged(page) });

export const listVocabulary = (userId: string, page: number) =>
  request<Page & { items: VocabularyItem[] }>(`/api/admin/users/${enc(userId)}/vocabulary`, { query: paged(page) });
