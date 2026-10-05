import type { ApiClient } from "~/api/client";
import type { Paged } from "~/api/types";
import type { GrammarResult } from "~/features/grammar/grammar-types";
import type { AssessmentScores, AssessmentWordBrief } from "~/features/practice/assessment-api";

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
}

export interface Conversation {
  id: string;
  name: string;
  config: ConversationConfig;
  createdAt: string;
  updatedAt: string;
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
}

export interface MessageResultFields {
  assessmentId?: string;
  grammar?: GrammarResult;
}

export type NewMessage = Pick<ChatMessage, "role" | "content"> & MessageResultFields;

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
  "Only user messages can carry assessment or grammar": "web.chat.errors.resultNotSaved",
  "Recording storage quota exceeded": "web.chat.errors.quota",
  "Pronunciation assessment is not configured": "web.chat.errors.assessmentNotConfigured",
};

const conversationPath = (id: string) => `/api/conversations/${encodeURIComponent(id)}`;

export function listConversations(api: ApiClient, page = 1, perPage = 20): Promise<Paged<"conversations", Conversation>> {
  return api.request("GET", "/api/conversations", { query: { page, per_page: perPage } });
}

export function createConversation(api: ApiClient, input: { name?: string; config: ConversationConfig }): Promise<Conversation> {
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
