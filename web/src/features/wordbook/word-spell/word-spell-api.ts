// 单词拼写接口(计划 2026-10-27 R-W3)。出题只读;作答走 wordbook-api.ts 的 /answers(mode: "free"),不另起判分。
import type { ApiClient } from "~/api/client";
import { type FreeItem, localOffsetMinutes } from "../wordbook-api";

export type WordSpellCount = 10 | 20;
export interface WordSpellSet { setId: string; bookId: string; items: FreeItem[] }

export const startWordSpell = (api: ApiClient, count: WordSpellCount = 10, signal?: AbortSignal) =>
  api.request<WordSpellSet>("POST", "/api/wordbook/word-spell/start", {
    json: { count, tzOffsetMinutes: localOffsetMinutes() },
    signal,
  });
