import { ApiError, type ApiClient } from "~/api/client";
import type { Paged } from "~/api/types";

export type VocabularySource = "lookup" | "recap" | "progress" | "manual";
export type VocabularyGrade = "forgot" | "hard" | "good";

export interface VocabularyItem {
  id: string;
  word: string;
  meaning: string;
  example: string | null;
  source: VocabularySource;
  box: number;
  dueAt: string;
  reps: number;
  lapses: number;
  lastReviewedAt: string | null;
  createdAt: string;
}

export interface VocabularyInput {
  word: string;
  meaning?: string;
  example?: string;
  source: VocabularySource;
}

export type VocabularyPage = Paged<"vocabularyItems", VocabularyItem> & { dueCount: number };

export const MAX_VOCAB_WORD = 100;
export const MAX_VOCAB_MEANING = 1000;
export const MAX_VOCAB_EXAMPLE = 500;
/** 设计文档 §3.5:复习一次最多 20 张 */
export const REVIEW_BATCH = 20;

export const VOCABULARY_SERVER_ERRORS: Record<string, string> = {
  "Vocabulary limit reached": "web.vocabulary.errors.limit",
  "Vocabulary item not found": "web.vocabulary.errors.notFound",
  "Vocabulary item is not due": "web.vocabulary.errors.notDue",
  "Vocabulary item was already reviewed": "web.vocabulary.errors.alreadyReviewed",
  "Vocabulary word is empty": "web.vocabulary.errors.emptyWord",
};

/** 按码点截断(服务端按 Python 字符计数),不会把代理对劈成半个字符。 */
export function clipCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join("");
}

// 服务端拒绝非空白控制字符;Python 视为空白的 \x1c-\x1f、\x85 与换行、制表符一样折叠成空格(不能删除,否则 "a\x85b" 会变成 "ab")。
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000e-\u001b\u007f-\u0084\u0086-\u009f]/g;
// eslint-disable-next-line no-control-regex
const PY_WHITESPACE_CONTROLS = /[\u001c-\u001f\u0085]/g;

function cleanWord(word: string): string {
  return clipCodePoints(word.replace(CONTROL_CHARS, "").replace(PY_WHITESPACE_CONTROLS, " ").replace(/\s+/g, " ").trim(), MAX_VOCAB_WORD).trim();
}

export function listVocabulary(
  api: ApiClient, { page = 1, perPage = 50, due = false }: { page?: number; perPage?: number; due?: boolean } = {}, signal?: AbortSignal,
): Promise<VocabularyPage> {
  return api.request("GET", "/api/vocabulary", { query: { page, per_page: perPage, due: due ? "true" : undefined }, signal });
}

export async function addVocabularyItem(api: ApiClient, input: VocabularyInput): Promise<VocabularyItem> {
  const word = cleanWord(input.word);
  // 清洗后为空则不发请求;走与服务端错误相同的翻译通道
  if (!word) throw new ApiError(422, "Vocabulary word is empty");
  return api.request("POST", "/api/vocabulary", {
    json: {
      word,
      ...(input.meaning ? { meaning: clipCodePoints(input.meaning, MAX_VOCAB_MEANING) } : {}),
      ...(input.example ? { example: clipCodePoints(input.example, MAX_VOCAB_EXAMPLE) } : {}),
      source: input.source,
    },
  });
}

export function deleteVocabularyItem(api: ApiClient, id: string, signal?: AbortSignal): Promise<{ id: string }> {
  return api.request("DELETE", `/api/vocabulary/${encodeURIComponent(id)}`, { signal });
}

export function reviewVocabularyItem(api: ApiClient, id: string, grade: VocabularyGrade, signal?: AbortSignal): Promise<VocabularyItem> {
  return api.request("POST", `/api/vocabulary/${encodeURIComponent(id)}/review`, { json: { grade }, signal });
}
