import type { ApiClient } from "~/api/client";

/** `GET /api/links/weak-words` 的一行(spec §6.4;客户端已转驼峰)。 */
export interface WeakWordItem { word: string; hits: number; lastScore: number | null; lastWeakAt: string; example: string | null }
export interface WeakWordsPage { items: WeakWordItem[]; total: number }
/** `GET /api/links/today-words` 的一行:今天学的新词与词卡第一条例句。 */
export interface TodayWord { key: string; word: string; example: { en: string; zh: string } | null }

const offset = () => -new Date().getTimezoneOffset();

export const fetchWeakWords = (api: ApiClient, signal?: AbortSignal) =>
  api.request<WeakWordsPage>("GET", "/api/links/weak-words", { signal });
export const dismissWeakWord = (api: ApiClient, word: string) =>
  api.request<{ word: string }>("POST", "/api/links/weak-words/dismiss", { json: { word } });
export const fetchTodayWords = (api: ApiClient, signal?: AbortSignal) =>
  api.request<{ items: TodayWord[] }>("GET", "/api/links/today-words", { query: { offset: offset() }, signal });
