import type { ApiClient } from "~/api/client";

/** 一条易错词(服务端 `GET /api/links/mistakes`,spec §6.3);释义与盒子来自用户自己的生词本行,没有则为空 / null。 */
export interface MistakeItem {
  word: string;
  wrongCount: number;
  lastWrongAt: string;
  meaning: string;
  box: number | null;
  dueAt: string | null;
  bookId: string;
}
export interface MistakesPageData { items: MistakeItem[]; next: number | null; total: number }

export const fetchMistakes = (api: ApiClient, page: number, signal?: AbortSignal) =>
  api.request<MistakesPageData>("GET", `/api/links/mistakes?page=${page}`, { signal });
export const dismissMistake = (api: ApiClient, word: string) =>
  api.request<{ word: string }>("POST", "/api/links/mistakes/dismiss", { json: { word } });
