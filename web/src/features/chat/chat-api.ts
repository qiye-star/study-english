import type { ApiClient } from "~/api/client";
import { ApiError } from "~/api/client";
import type { Paged } from "~/api/types";
import type { AgentTrace } from "~/features/agents";
import type { GrammarResult } from "~/features/grammar";
import type { AssessmentScores, AssessmentWordBrief } from "~/features/practice";
import type { Level } from "./levels";

/** 场景(R1、R9):id 为 free / 预设 id / custom;custom 时带清洗后的自定义文本。 */
export interface ScenarioRef {
  id: string;
  custom?: string;
}

export interface RecapExpression {
  text: string;
  zh: string;
}

/** 复盘结果(R13),存在会话配置里;服务端 snake_case。 */
export interface StoredRecap {
  generatedAt: string;
  messageCount: number;
  level: string;
  summaryZh: string;
  newExpressions: RecapExpression[];
  suggestionsZh: string[];
}

export interface ConversationConfig {
  systemPrompt: string;
  model: string;
  temperature: number;
  ttsModel: string;
  ttsVoice: string;
  /** 新回复流式结束后自动翻译(R14,默认 false) */
  bilingual?: boolean;
  /** 自动语法检查(默认 true) */
  grammarCheck?: boolean;
  /** 教练模式(默认 false) */
  coachMode?: boolean;
  /** 自动朗读新回复(R1:缺省 = 开,旧会话同样默认开) */
  autoSpeak?: boolean;
  /** 难度(缺省 auto) */
  level?: Level;
  /** 场景(缺省 = 自由对话) */
  scenario?: ScenarioRef;
  /** 复盘结果 */
  recap?: StoredRecap;
  /** 智能体角色(spec §9.3):有值时回复走 /api/agents/turn;缺省 = 旧路径完全不变(R-W12) */
  agentPersonaId?: string;
  /** 中文提示(对话级覆盖用户设置;今天的默认对话按问候语言写,chat home R7);网页只经 saveSettings 写,落库是 zh_note */
  zhNote?: "auto" | "always" | "never";
}

export interface Conversation {
  id: string;
  name: string;
  config: ConversationConfig;
  createdAt: string;
  updatedAt: string;
  /** 每日默认对话的本地日 "YYYY-MM-DD"(服务端给定,不做时区换算);普通对话没有 */
  dailyDate?: string | null;
}

export interface MessageAssessment {
  id: string;
  scores: AssessmentScores;
  words: AssessmentWordBrief[];
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  assessmentId?: string | null;
  grammar?: GrammarResult | null;
  /** 服务端只读摘要(R9) */
  assessment?: MessageAssessment | null;
  /** 智能体回复的压缩过程(messages.agent_trace,≤ 4 KB);旧消息没有 */
  agentTrace?: AgentTrace | null;
}

export interface MessageResultFields {
  assessmentId?: string;
  grammar?: GrammarResult;
}

export type NewMessage = Pick<ChatMessage, "role" | "content"> & MessageResultFields & { agentTrace?: AgentTrace };

export const DEFAULT_CONVERSATION_NAME = "New conversation";

export const CHAT_SERVER_ERRORS: Record<string, string> = {
  "LLM upstream is not configured": "web.chat.errors.notConfigured",
  "Upstream unavailable": "web.chat.errors.upstream",
  "Upstream authentication failed": "web.chat.errors.upstream",
  "Empty AI response": "web.chat.errors.empty",
  "Message limit reached": "web.chat.errors.messageLimit",
  "Conversation limit reached": "web.chat.errors.conversationLimit",
  "Conversation not found": "web.chat.errors.notFound",
  "Whisper upstream is not configured": "web.chat.errors.sttNotConfigured",
  "Unsupported audio format (wav or mp3)": "web.chat.errors.sttFormat",
  "Message not found": "web.chat.errors.resultNotSaved",
  "Assessment not found": "web.chat.errors.resultNotSaved",
  "Assessment already linked to another message": "web.chat.errors.resultNotSaved",
  "Nothing to update": "web.chat.errors.resultNotSaved",
  "Invalid grammar result": "web.chat.errors.resultNotSaved",
  "Message already has an assessment": "web.chat.errors.resultNotSaved",
  "Config is too large": "web.chat.errors.configTooLarge",
  "Only user messages can carry assessment or grammar": "web.chat.errors.resultNotSaved",
  "Recording storage quota exceeded": "web.chat.errors.quota",
  "Pronunciation assessment is not configured": "web.chat.errors.assessmentNotConfigured",
};

const conversationPath = (id: string) => `/api/conversations/${encodeURIComponent(id)}`;

/** `opts` 只给对话主页的抽屉用:隐藏没回过的旧默认对话(R11);旧调用的请求不变。 */
export interface ListConversationsOptions { hideIdleDaily?: boolean; tzOffsetMinutes?: number }

export function listConversations(api: ApiClient, page = 1, perPage = 20, opts: ListConversationsOptions = {}): Promise<Paged<"conversations", Conversation>> {
  const query: Record<string, string | number> = { page, per_page: perPage };
  if (opts.hideIdleDaily) query.hide_idle_daily = "true";
  if (opts.tzOffsetMinutes !== undefined) query.tz_offset_minutes = opts.tzOffsetMinutes;
  return api.request("GET", "/api/conversations", { query });
}

export function createConversation(api: ApiClient, input: { name?: string; config: Partial<ConversationConfig> }): Promise<Conversation> {
  return api.request("POST", "/api/conversations", { json: input });
}

export function getConversation(api: ApiClient, id: string): Promise<Conversation> {
  return api.request("GET", conversationPath(id));
}

export function updateConversation(api: ApiClient, id: string, patch: { name?: string; config?: ConversationConfig }): Promise<Conversation> {
  return api.request("PATCH", conversationPath(id), { json: patch });
}

export function deleteConversation(api: ApiClient, id: string): Promise<{ id: string }> {
  return api.request("DELETE", conversationPath(id));
}

export function listMessages(api: ApiClient, conversationId: string): Promise<{ messages: ChatMessage[] }> {
  return api.request("GET", `${conversationPath(conversationId)}/messages`);
}

export function createMessages(
  api: ApiClient,
  conversationId: string,
  messages: NewMessage[],
): Promise<{ messages: ChatMessage[] }> {
  return api.request("POST", `${conversationPath(conversationId)}/messages`, { json: { messages } });
}

export function deleteMessage(api: ApiClient, id: string): Promise<{ id: string }> {
  return api.request("DELETE", `/api/messages/${encodeURIComponent(id)}`);
}

export function patchMessage(api: ApiClient, id: string, fields: MessageResultFields): Promise<ChatMessage> {
  return api.request("PATCH", `/api/messages/${encodeURIComponent(id)}`, { json: fields });
}

/** 服务端可能已经保存、只是响应没到:网络错误/超时(status 0)、5xx、408 */
export const isAmbiguousSaveError = (err: unknown) =>
  !(err instanceof ApiError) || err.status === 0 || err.status >= 500 || err.status === 408;
