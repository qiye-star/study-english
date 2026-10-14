/** 精选库管理接口(spec 2026-10-14-curated-library §9;服务端 routers/admin_catalog.py)。wire 是 snake_case,这里转 camelCase。 */
import { request } from "../../api/client";

export type CatalogStatus = "uploading" | "queued" | "processing" | "ready" | "failed" | "canceled";
export const ACTIVE: CatalogStatus[] = ["uploading", "queued", "processing"];

export interface CatalogRow {
  id: string; title: string; level: string | null; tags: string[]; licenseNote: string | null;
  source: "upload" | "link"; sourceHost: string | null; status: CatalogStatus; stage: string | null; progress: number;
  errorKind: string | null; durationMs: number | null; segCount: number; translated: number; subSource: string | null;
  lowConfidence: boolean; mediaBytes: number; hasPoster: boolean; mediaMissing: boolean; aiLang: string;
  published: boolean; publishedAt: string | null; retired: boolean; refs: number; uploadReceived: number;
  uploadTotal: number; createdAt: string; updatedAt: string;
}
export interface CatalogSegment { idx: number; startMs: number; endMs: number; text: string; zh: string | null; zhLang: string | null; hasAnalysis: boolean; flags: string[] }
export interface CatalogState {
  enabled: boolean; available: boolean; asr: boolean; ai: boolean; link: boolean; proxyConfigured: boolean;
  aiDaily: number; aiToday: number; languages: string[]; levels: string[]; chunkBytes: number; maxUploadMb: number; formats: string[];
}
export interface CatalogMeta { title?: string; level?: string | null; tags?: string[]; licenseNote?: string | null }
export interface NewMeta extends CatalogMeta { aiLang?: string }
export interface UploadState { catalogId: string; status: CatalogStatus; uploadReceived: number; uploadTotal: number; chunkBytes: number }

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
const snakeMeta = (m: NewMeta) => {
  const out: Record<string, unknown> = {};
  if (m.title !== undefined) out.title = m.title;
  if (m.level !== undefined) out.level = m.level;
  if (m.tags !== undefined) out.tags = m.tags;
  if (m.licenseNote !== undefined) out.license_note = m.licenseNote;
  if (m.aiLang !== undefined) out.ai_lang = m.aiLang;
  return out;
};

const BASE = "/api/admin/library/catalog";
const enc = encodeURIComponent;
export const deletePhrase = (id: string) => `DELETE ${id.slice(0, 8)}`;
export const purgePhrase = (id: string) => `PURGE ${id.slice(0, 8)}`;
export const mediaUrl = (id: string) => `${BASE}/${enc(id)}/media`;
export const posterUrl = (id: string) => `${BASE}/${enc(id)}/poster`;

export const fetchCatalog = async () => camel<{ items: CatalogRow[]; state: CatalogState }>(await request<unknown>(BASE));
export const fetchCatalogItem = async (id: string) =>
  camel<{ item: CatalogRow; segments: CatalogSegment[] }>(await request<unknown>(`${BASE}/${enc(id)}`));
const itemOf = async (p: Promise<unknown>) => camel<{ item: CatalogRow }>(await p).item;
export const importLink = (url: string, meta: NewMeta) => itemOf(request(`${BASE}/imports`, { json: { url, ...snakeMeta(meta) } }));
export const startUpload = async (filename: string, size: number, meta: NewMeta) =>
  camel<{ catalogId: string; chunkBytes: number }>(await request(`${BASE}/uploads`, { json: { filename, size, ...snakeMeta(meta) } }));
export const putChunk = async (id: string, n: number, blob: Blob, signal?: AbortSignal) => {
  const form = new FormData();
  form.append("chunk", blob, "blob");
  return camel<UploadState>(await request(`${BASE}/uploads/${enc(id)}/chunks/${n}`, { method: "PUT", form, signal }));
};
export const putSubtitles = async (id: string, file: Blob, name: string) => {
  const form = new FormData();
  form.append("file", file, name);
  return camel<{ cueCount: number }>(await request(`${BASE}/uploads/${enc(id)}/subtitles`, { method: "PUT", form }));
};
export const completeUpload = (id: string) => itemOf(request(`${BASE}/uploads/${enc(id)}/complete`, { method: "POST", json: {} }));
export const patchMeta = (id: string, meta: CatalogMeta) => itemOf(request(`${BASE}/${enc(id)}`, { method: "PATCH", json: snakeMeta(meta) }));
const action = (name: string) => (id: string) => itemOf(request(`${BASE}/${enc(id)}/${name}`, { method: "POST", json: {} }));
export const publish = action("publish");
export const unpublish = action("unpublish");
export const retry = action("retry");
export const cancel = action("cancel");
export const translateMissing = action("translate");
export const patchSegment = async (id: string, idx: number, patch: { text?: string; zh?: string; startMs?: number; endMs?: number }) => {
  const json: Record<string, unknown> = {};
  if (patch.text !== undefined) json.text = patch.text;
  if (patch.zh !== undefined) json.zh = patch.zh;
  if (patch.startMs !== undefined) json.start_ms = patch.startMs;
  if (patch.endMs !== undefined) json.end_ms = patch.endMs;
  return camel<{ segment: CatalogSegment }>(await request(`${BASE}/${enc(id)}/segments/${idx}`, { method: "PATCH", json })).segment;
};
export const deleteItem = (id: string, reason: string, confirm: string) =>
  request<{ id: string; outcome: "deleted" | "retired"; refs: number }>(`${BASE}/${enc(id)}/delete`, { method: "POST", json: { reason, confirm } });
export const purgeItem = async (id: string, reason: string, confirm: string) =>
  camel<{ id: string; copiesDeleted: number; users: number }>(await request(`${BASE}/${enc(id)}/purge`, { method: "POST", json: { reason, confirm } }));
