import type { ApiClient } from "~/api/client";

/**
 * 词汇激活接口(plan L4 Task 11/15/16;形状见 server/tests/fixtures/activation_contract.json)。
 * ApiClient 已把响应键转成 camelCase。解析是防御性的:形状不对的词丢掉。词只出现在响应体里,从不进 URL。
 */
export const ACTIVATION_STATES = ["dormant", "sprouting", "active"] as const;
export type ActivationState = (typeof ACTIVATION_STATES)[number];
export interface ActivationWord { word: string; bookId: string; learnedAt: string; lastUsedAt: string | null; useCount: number }
export interface ActivationWords { state: ActivationState; items: ActivationWord[]; counts: Record<ActivationState, number>; next: number | null }
export interface ActivationConfig { enabled: boolean }
export interface PromptHint { words: string[]; block: string | null }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const isState = (v: unknown): v is ActivationState => (ACTIVATION_STATES as readonly unknown[]).includes(v);

function parseWord(raw: unknown): ActivationWord | null {
  if (!isRecord(raw)) return null;
  const word = str(raw.word);
  if (!word) return null;
  return {
    word,
    bookId: str(raw.bookId),
    learnedAt: str(raw.learnedAt),
    lastUsedAt: typeof raw.lastUsedAt === "string" && raw.lastUsedAt ? raw.lastUsedAt : null,
    useCount: count(raw.useCount),
  };
}

export function parseWords(raw: unknown): ActivationWords {
  const r = isRecord(raw) ? raw : {};
  const counts = isRecord(r.counts) ? r.counts : {};
  return {
    state: isState(r.state) ? r.state : "dormant",
    items: Array.isArray(r.items) ? r.items.map(parseWord).filter((w): w is ActivationWord => w !== null) : [],
    counts: { dormant: count(counts.dormant), sprouting: count(counts.sprouting), active: count(counts.active) },
    next: typeof r.nextPage === "number" && r.nextPage >= 0 ? Math.floor(r.nextPage) : null,
  };
}

export async function fetchActivationConfig(api: ApiClient, signal?: AbortSignal): Promise<ActivationConfig> {
  const raw = await api.request<unknown>("GET", "/api/activation/config", { timeoutMs: 10_000, signal });
  return { enabled: isRecord(raw) && raw.enabled === true };
}

export async function fetchWords(api: ApiClient, state: ActivationState, page = 0, signal?: AbortSignal): Promise<ActivationWords> {
  const raw = await api.request<unknown>("GET", "/api/activation/words", { query: { state, page }, timeoutMs: 15_000, signal });
  return parseWords(raw);
}

export async function fetchPromptHint(api: ApiClient, offset: number, signal?: AbortSignal): Promise<PromptHint> {
  const raw = await api.request<unknown>("GET", "/api/activation/prompt-hint", { query: { offset }, timeoutMs: 10_000, signal });
  const r = isRecord(raw) ? raw : {};
  const words = Array.isArray(r.words) ? r.words.map(str).filter(Boolean) : [];
  return { words, block: words.length && typeof r.block === "string" && r.block ? r.block : null };
}
