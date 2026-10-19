export interface Scores {
  pronunciation_score: number | null;
  accuracy_score: number | null;
  fluency_score: number | null;
  completeness_score: number | null;
}

export type Source = "practice" | "chat";
export type SourceFilter = "all" | Source;

export interface Page {
  page: number;
  next: number | null;
}

export interface Totals {
  users: number;
  conversations: number;
  messages: number;
  assessments: number;
  vocabulary: number;
  practice_items: number;
  recording_bytes: number;
}

export interface DailyPoint {
  date: string;
  new_users: number;
  messages: number;
  assessments: number;
}

export interface Overview {
  totals: Totals;
  daily: DailyPoint[];
}

export interface UserSummary {
  id: string;
  username: string;
  created_at: string;
  conversations: number;
  assessments: number;
  recording_bytes: number;
  last_active_at: string | null;
  /** 脱敏邮箱(如 a***@qq.com);未绑定为 null。从不返回完整邮箱。 */
  email_masked?: string | null;
  email_verified?: boolean;
}

export interface UsersPage extends Page {
  users: UserSummary[];
  total: number;
}

export interface UserDetail {
  id: string;
  username: string;
  created_at: string;
  grammar_prompt: string | null;
  counts: { conversations: number; messages: number; assessments: number; practice_items: number; vocabulary: number };
  recording_bytes: number;
  last_active_at: string | null;
  email_masked?: string | null;
  email_verified?: boolean;
}

export interface ConversationItem {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface MessageAssessment {
  id: string;
  scores: Scores;
  duration_ms: number | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  grammar: Record<string, unknown> | null;
  assessment_id: string | null;
  assessment: MessageAssessment | null;
}

export interface ConversationMessages {
  conversation: {
    id: string;
    name: string;
    user_id: string;
    username: string;
    config: unknown;
    created_at: string;
    updated_at: string;
  };
  messages: ChatMessage[];
}

export interface AssessmentItem {
  id: string;
  reference_text: string;
  language: string;
  duration_ms: number | null;
  audio_bytes: number | null;
  source: Source;
  scores: Scores;
  created_at: string;
  /** 仅全局列表与详情提供 */
  user_id?: string;
  username?: string;
}

export interface AssessmentDetail extends AssessmentItem {
  result: Record<string, unknown> | null;
}

export interface PracticeItem {
  id: string;
  text: string;
  source: string;
  created_at: string;
}

export interface VocabularyItem {
  id: string;
  word: string;
  meaning: string;
  example: string | null;
  source: string;
  box: number;
  due_at: string;
  reps: number;
  lapses: number;
  last_reviewed_at: string | null;
  created_at: string;
}

/** `POST /api/admin/login`、`POST /login/totp`、`GET /session` 的响应(snake_case 原样) */
export interface SessionWire {
  username: string;
  role: "viewer" | "operator" | "superadmin";
  csrf_token: string;
  expires_at: string;
  mfa_required: boolean;
  step_up_until: string | null;
  totp_enabled: boolean;
  safe_mode: boolean;
  maintenance_mode: "off" | "read_only" | "full";
}
