import type { ApiClient } from "~/api/client";
import type { Paged } from "~/api/types";

export interface ConversationConfig {
  systemPrompt: string;
  model: string;
  temperature: number;
  ttsModel: string;
  ttsVoice: string;
}

export interface Conversation {
  id: string;
  name: string;
  config: ConversationConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

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
  messages: Array<Pick<ChatMessage, "role" | "content">>,
): Promise<{ messages: ChatMessage[] }> {
  return api.request("POST", `${conversationPath(conversationId)}/messages`, { json: { messages } });
}

export function deleteMessage(api: ApiClient, id: string): Promise<{ id: string }> {
  return api.request("DELETE", `/api/messages/${encodeURIComponent(id)}`);
}
