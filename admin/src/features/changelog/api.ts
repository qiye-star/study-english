import { request } from "../../api/client";

/** 更新日志管理接口(/api/admin/changelog)。snake_case → camelCase,形状见 server/tests/fixtures/changelog_contract.json。 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const TAGS = ["new", "improve", "fix", "library", "other"] as const;
export type ChangelogTag = (typeof TAGS)[number];
export type EntryStatus = "draft" | "published";

export interface ChangelogItem {
  tag: ChangelogTag;
  zh: string;
  en: string;
}

export interface ChangelogEntry {
  id: number;
  status: EntryStatus;
  entryDate: string;
  version: string | null;
  titleZh: string;
  titleEn: string;
  items: ChangelogItem[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ChangelogInput {
  entryDate: string;
  version: string | null;
  titleZh: string;
  titleEn: string;
  items: ChangelogItem[];
}

const toEntry = (r: any): ChangelogEntry => ({
  id: r.id,
  status: r.status === "published" ? "published" : "draft",
  entryDate: r.entry_date,
  version: r.version ?? null,
  titleZh: r.title_zh,
  titleEn: r.title_en ?? "",
  items: (r.items ?? []).map((i: any) => ({ tag: i.tag, zh: i.zh, en: i.en ?? "" })),
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  publishedAt: r.published_at ?? null,
});

const fromInput = (d: ChangelogInput) => ({
  entry_date: d.entryDate,
  version: d.version,
  title_zh: d.titleZh,
  title_en: d.titleEn,
  items: d.items.map((i) => ({ tag: i.tag, zh: i.zh, en: i.en })),
});

export async function listEntries(): Promise<ChangelogEntry[]> {
  const r = await request<{ entries: any[] }>("/api/admin/changelog");
  return r.entries.map(toEntry);
}

export async function createEntry(data: ChangelogInput): Promise<ChangelogEntry> {
  return toEntry(await request("/api/admin/changelog", { method: "POST", json: fromInput(data) }));
}

export async function updateEntry(id: number, data: ChangelogInput): Promise<ChangelogEntry> {
  return toEntry(await request(`/api/admin/changelog/${id}`, { method: "PATCH", json: fromInput(data) }));
}

export async function publishEntry(id: number): Promise<ChangelogEntry> {
  return toEntry(await request(`/api/admin/changelog/${id}/publish`, { method: "POST" }));
}

export async function unpublishEntry(id: number): Promise<ChangelogEntry> {
  return toEntry(await request(`/api/admin/changelog/${id}/unpublish`, { method: "POST" }));
}

export async function deleteEntry(id: number): Promise<void> {
  await request(`/api/admin/changelog/${id}`, { method: "DELETE" });
}
