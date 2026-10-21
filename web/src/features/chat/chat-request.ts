import type { ChatMessageInput } from "~/api/ai";
import type { ServerAiConfig } from "~/api/server-config";
import { levelInstruction, normalizeLevel, type Level } from "./levels";
import { scenarioSystemPrompt } from "./scenarios";
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

/** R3:基础提示词(非自由场景用场景提示词,否则 systemPrompt)+ 难度要求。 */
export function effectiveSystemPrompt(config: ConversationConfig): string {
  const base = scenarioSystemPrompt(config.scenario) ?? config.systemPrompt ?? "";
  return [base, levelInstruction(normalizeLevel(config.level))].filter((part) => part.trim()).join("\n\n");
}

/** 实时通话开始消息里提示词的上限(服务端 `START_LIMITS.systemPrompt`,按码点计;与 features/realtime/protocol.ts 一致)。 */
export const REALTIME_PROMPT_MAX = 8000;

/** 对话提示词补充(计划 L4 Task 16):把一段补充接在基础提示词后面;没有补充时逐字返回基础提示词。 */
export function withPromptHint(base: string, hint: string | null): string {
  if (!hint || !hint.trim()) return base;
  return [base, hint].filter((part) => part.trim()).join("\n\n");
}

/** 实时通话的提示词按码点截断,与服务端 `START_LIMITS.systemPrompt` 一致。 */
export function capRealtimePrompt(text: string): string {
  return Array.from(text).slice(0, REALTIME_PROMPT_MAX).join("");
}

export function buildChatMessages(
  config: ConversationConfig,
  history: Array<Pick<ChatMessage, "role" | "content">>,
  userText: string,
  limit = HISTORY_LIMIT,
  coach: string | null = null,
): ChatMessageInput[] {
  const recent = history.filter((m) => m.role !== "system").slice(-limit);
  const base = effectiveSystemPrompt(config);
  const system = coach ? (base.trim() ? [base, coach].join("\n\n") : coach) : base;
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
  autoSpeak: boolean;
  level: Level;
}

/** 会话设置项的默认值(R14、R1):旧会话没有这些键时按默认处理,新建会话也不必写入。 */
export function chatOptions(config: Partial<ConversationConfig> | undefined): ChatOptions {
  return {
    bilingual: config?.bilingual === true,
    grammarCheck: config?.grammarCheck !== false,
    coachMode: config?.coachMode === true,
    autoSpeak: config?.autoSpeak !== false,
    level: normalizeLevel(config?.level),
  };
}
