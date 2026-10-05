import type { ApiClient } from "~/api/client";
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
};

/** 按码点截断(服务端按 Python 字符计数),不会把代理对劈成半个字符。 */
export function clipCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join("");
}

// 服务端拒绝非空白控制字符;空白控制符(\n、\t)在下面被折叠成空格。
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;

function cleanWord(word: string): string {
  return clipCodePoints(word.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim(), MAX_VOCAB_WORD).trim();
}

export function listVocabulary(
  api: ApiClient, { page = 1, perPage = 50, due = false }: { page?: number; perPage?: number; due?: boolean } = {}, signal?: AbortSignal,
): Promise<VocabularyPage> {
  return api.request("GET", "/api/vocabulary", { query: { page, per_page: perPage, due: due ? "true" : undefined }, signal });
}

export function addVocabularyItem(api: ApiClient, input: VocabularyInput): Promise<VocabularyItem> {
  return api.request("POST", "/api/vocabulary", {
    json: {
      word: cleanWord(input.word),
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
