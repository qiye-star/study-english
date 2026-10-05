import type { ChatMessageInput } from "~/api/ai";
import type { ServerAiConfig } from "~/api/server-config";
import { DEFAULT_CONVERSATION_NAME, type ChatMessage, type Conversation, type ConversationConfig } from "./chat-api";

export const DEFAULT_SYSTEM_PROMPT =
  "You are a friendly English conversation partner for a language learner. Reply in natural, simple English " +
  "in no more than three sentences, and end with a short question to keep the conversation going.";
export const HISTORY_LIMIT = 20;

export function defaultConversationConfig(ai: ServerAiConfig | null): ConversationConfig {
  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    model: ai?.defaultLlmModel ?? "",
    temperature: 0.7,
    ttsModel: ai?.defaultTts.model ?? "",
    ttsVoice: ai?.defaultTts.voice ?? "",
  };
}

export function withConfigDefaults(config: Partial<ConversationConfig> | undefined, ai: ServerAiConfig | null): ConversationConfig {
  const defined = Object.fromEntries(Object.entries(config ?? {}).filter(([, v]) => v !== undefined && v !== null));
  return { ...defaultConversationConfig(ai), ...defined };
}

export function buildChatMessages(
  config: ConversationConfig,
  history: Array<Pick<ChatMessage, "role" | "content">>,
  userText: string,
  limit = HISTORY_LIMIT,
  coach: string | null = null,
): ChatMessageInput[] {
  const recent = history.filter((m) => m.role !== "system").slice(-limit);
  const system = coach ? (config.systemPrompt.trim() ? `${config.systemPrompt}

${coach}` : coach) : config.systemPrompt;
  return [
    ...(system.trim() ? [{ role: "system" as const, content: system }] : []),
    ...recent.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userText },
  ];
}

export function titleFrom(text: string, max = 30): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

export function displayName(conversation: Pick<Conversation, "name">, untitled: string): string {
  return conversation.name === DEFAULT_CONVERSATION_NAME ? untitled : conversation.name;
}

export interface ChatOptions {
  bilingual: boolean;
  grammarCheck: boolean;
  coachMode: boolean;
}

/** 会话设置项的默认值(R14):旧会话没有这些键时按默认处理,新建会话也不必写入。 */
export function chatOptions(config: Partial<ConversationConfig> | undefined): ChatOptions {
  return {
    bilingual: config?.bilingual === true,
    grammarCheck: config?.grammarCheck !== false,
    coachMode: config?.coachMode === true,
  };
}
