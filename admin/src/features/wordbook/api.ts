/** 词书管理接口(设计文档 2026-10-10-wordbook §9;服务端 routers/admin_wordbook.py,A1 实现)。
 * wire 是 snake_case,这里转成 camelCase。导出名与类型是 F4 定下的最终形状(计划 P-W4),A 车道只补实现与页面。 */
import { request } from "../../api/client";

export interface WordbookBookAdmin {
  id: string; titleZh: string; enabled: boolean;
  file: { bytes: number; sha256Ok: boolean | null; entries: number; unique: number };
  index: { loaded: boolean; keys: number; dropped: number; builtMs: number | null; stale: boolean };
  learners: number; learners7d: number; learned: number; mastered: number; reportsOpen: number;
}
export interface WordbookAdmin {
  enabled: boolean;
  ai: { enabled: boolean; available: boolean; todayCalls: number; globalDaily: number; cached: number };
  books: WordbookBookAdmin[];
}
export interface WordbookReportRow {
  id: number; bookId: string; word: string; sentenceId: string; sentence: string | null; reason: string; count: number; createdAt: string;
}

/** snake_case → camelCase(深层);数字也算一段(`learners_7d` → `learners7d`)。 */
const camelKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export function camel<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camel(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[camelKey(k)] = camel(v);
    return out as T;
  }
  return value as T;
}

export const fetchWordbookAdmin = async (): Promise<WordbookAdmin> =>
  camel<WordbookAdmin>(await request<unknown>("/api/admin/wordbook"));

export const reloadWordbook = (reason: string) =>
  request<{ ok: true }>("/api/admin/wordbook/reload", { method: "POST", json: { reason } });

export const fetchReports = async (): Promise<{ reports: WordbookReportRow[] }> =>
  camel<{ reports: WordbookReportRow[] }>(await request<unknown>("/api/admin/wordbook/reports"));

export const hideReport = (id: number, reason: string) =>
  request<{ ok: true }>(`/api/admin/wordbook/reports/${id}/hide`, { method: "POST", json: { reason } });

export const dismissReport = (id: number, reason: string) =>
  request<{ ok: true }>(`/api/admin/wordbook/reports/${id}/dismiss`, { method: "POST", json: { reason } });
