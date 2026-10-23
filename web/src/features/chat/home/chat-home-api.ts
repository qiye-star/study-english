import type { ApiClient } from "~/api/client";
import type { Conversation } from "../chat-api";

// 契约:服务端计划 §5 / §5.1;键名由 ApiClient 在 snake_case ↔ camelCase 之间转换。
// 隐私:这里的请求没有问候文字 / 消息 / 词 / 用户 id 进 URL;查询参数只有固定名称。

export type GreetingLanguage = "zh" | "en" | "bilingual";
export type GreetingTrigger = "daily" | "every_open" | "off";
export interface ChatHomeConfig { enabled: boolean; llm: boolean }
export interface ChatPrefs { greetingTrigger: GreetingTrigger; language: GreetingLanguage; dailyPersonaId: string; includeStats: boolean }
/** 可含 R17 的 `*…*` 强调,经 `emphasis.ts` 渲染 */
export interface GreetingLine { en?: string; zh?: string }
export interface GreetingFacts { streak?: number; due?: number; yesterdayMistakes?: number }
export interface TodayGreeting {
  id: string;
  messageIds: string[];
  source: "llm" | "template";
  language: GreetingLanguage;
  /** ISO UTC;问候组小标题「今日问候 · 08:42」 */
  generatedAt: string;
  /** 恰好 3 段 */
  lines: [GreetingLine, GreetingLine, GreetingLine];
  /** include_stats=false → {}(R16) */
  facts: GreetingFacts;
  firstView: boolean;
}
export interface TodayResult {
  localDate: string;
  status: "ready" | "pending" | "off";
  conversation: Conversation & { dailyDate: string };
  greeting: TodayGreeting | null;
}

/** 服务端错误原文 → i18n key(translateServerError 的 extra 表)。422 的 `field` 被 ApiClient 丢弃,界面不需要它。 */
export const CHAT_HOME_SERVER_ERRORS: Record<string, string> = {
  invalid: "web.chat.home.errors.invalid",
  "Greeting not found": "web.chat.home.errors.notFound",
  "Chat home is disabled": "web.chat.home.errors.disabled",
};

const NUM_FACTS = ["streak", "due", "yesterdayMistakes"] as const;

/** 只留已知的数字键;未知键忽略,非有限数字丢弃。 */
export function cleanFacts(raw: unknown): GreetingFacts {
  const out: GreetingFacts = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of NUM_FACTS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

const textOf = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

/**
 * 防御:`lines` 不是恰好 3 条,或某行缺少该语言要求的键(`zh` / `en` / 双语两者)→ 视为无问候(返回 null)。
 * 语言取问候自带的 `language`(用户当天改了设置,已存问候仍按生成时的语言)。
 */
export function cleanGreeting(raw: TodayGreeting | null | undefined): TodayGreeting | null {
  if (!raw || !Array.isArray(raw.lines) || raw.lines.length !== 3) return null;
  const lang = raw.language;
  if (lang !== "zh" && lang !== "en" && lang !== "bilingual") return null;
  const lines = raw.lines.map((l) => {
    const en = textOf(l?.en);
    const zh = textOf(l?.zh);
    const ok = lang === "zh" ? !!zh : lang === "en" ? !!en : !!en && !!zh;
    return ok ? { ...(en ? { en } : {}), ...(zh ? { zh } : {}) } : null;
  });
  if (lines.some((l) => !l)) return null;
  return { ...raw, lines: lines as TodayGreeting["lines"], facts: cleanFacts(raw.facts), messageIds: Array.isArray(raw.messageIds) ? raw.messageIds : [] };
}

export function getChatHomeConfig(api: ApiClient, signal?: AbortSignal): Promise<ChatHomeConfig> {
  return api.request("GET", "/api/chat-home/config", { signal });
}

export function getChatPrefs(api: ApiClient, signal?: AbortSignal): Promise<ChatPrefs> {
  return api.request("GET", "/api/chat-home/settings", { signal });
}

export function patchChatPrefs(api: ApiClient, partial: Partial<ChatPrefs>): Promise<ChatPrefs> {
  return api.request("PATCH", "/api/chat-home/settings", { json: partial });
}

export async function postToday(api: ApiClient, input: { tzOffsetMinutes: number; clientRequestId: string }, signal?: AbortSignal): Promise<TodayResult> {
  const result = await api.request<TodayResult>("POST", "/api/chat-home/today", { json: input, signal });
  return { ...result, greeting: cleanGreeting(result.greeting) };
}

export function markGreetingSeen(api: ApiClient, greetingId: string): Promise<{ firstSeenAt: string }> {
  return api.request("POST", `/api/chat-home/greetings/${encodeURIComponent(greetingId)}/seen`);
}
