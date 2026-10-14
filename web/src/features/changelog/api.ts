import type { ApiClient } from "~/api/client";

/**
 * 更新日志接口(spec 2026-10-14-changelog §2.1;形状见 server/tests/fixtures/changelog_contract.json)。
 * ApiClient 已把响应键转成 camelCase。解析是防御性的:形状不对的条目丢掉,未知类型按 "other" 显示。
 */
export const TAGS = ["new", "improve", "fix", "library", "other"] as const;
export type ChangelogTag = (typeof TAGS)[number];
export interface ChangelogItem { tag: ChangelogTag; zh: string; en: string }
export interface ChangelogEntry {
  id: number;
  entryDate: string;
  version: string | null;
  titleZh: string;
  titleEn: string;
  items: ChangelogItem[];
  publishedAt: string;
  isNew: boolean;
}
export interface ChangelogPage { entries: ChangelogEntry[]; next: string | null; unread: number; latestId: number | null }
export interface SeenResult { unread: number; lastSeenId: number }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isTag = (v: unknown): v is ChangelogTag => (TAGS as readonly unknown[]).includes(v);
const nonNull = <T>(v: T | null): v is T => v !== null;

function parseItem(raw: unknown): ChangelogItem | null {
  if (!isRecord(raw)) return null;
  const zh = str(raw.zh);
  const en = str(raw.en);
  if (!zh && !en) return null;
  return { tag: isTag(raw.tag) ? raw.tag : "other", zh, en };
}

function parseEntry(raw: unknown): ChangelogEntry | null {
  if (!isRecord(raw) || typeof raw.id !== "number" || typeof raw.entryDate !== "string") return null;
  const items = Array.isArray(raw.items) ? raw.items.map(parseItem).filter(nonNull) : [];
  if (items.length === 0) return null;
  return {
    id: raw.id,
    entryDate: raw.entryDate,
    version: typeof raw.version === "string" && raw.version ? raw.version : null,
    titleZh: str(raw.titleZh),
    titleEn: str(raw.titleEn),
    items,
    publishedAt: str(raw.publishedAt),
    isNew: raw.isNew === true,
  };
}

export function parseChangelogPage(raw: unknown): ChangelogPage {
  const r = isRecord(raw) ? raw : {};
  return {
    entries: Array.isArray(r.entries) ? r.entries.map(parseEntry).filter(nonNull) : [],
    next: typeof r.next === "string" && r.next ? r.next : null,
    unread: typeof r.unread === "number" && r.unread > 0 ? Math.floor(r.unread) : 0,
    latestId: typeof r.latestId === "number" ? r.latestId : null,
  };
}

export async function fetchChangelog(api: ApiClient, opts: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<ChangelogPage> {
  const raw = await api.request<unknown>("GET", "/api/changelog", {
    query: { cursor: opts.cursor, limit: opts.limit }, signal: opts.signal, timeoutMs: 15_000,
  });
  return parseChangelogPage(raw);
}

export async function postSeen(api: ApiClient, uptoId: number, signal?: AbortSignal): Promise<SeenResult> {
  const raw = await api.request<unknown>("POST", "/api/changelog/seen", { json: { uptoId }, signal, timeoutMs: 10_000 });
  const r = isRecord(raw) ? raw : {};
  return {
    unread: typeof r.unread === "number" && r.unread > 0 ? Math.floor(r.unread) : 0,
    lastSeenId: typeof r.lastSeenId === "number" ? r.lastSeenId : 0,
  };
}
