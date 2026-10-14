import type { ApiClient } from "~/api/client";
import type { LibraryItem } from "./library-api";

/** 精选库卡片(spec 2026-10-14-curated-library §9;服务端 catalog_store.public_out,ApiClient 已转 camelCase)。 */
export interface CatalogCard {
  id: string;
  title: string;
  level: string | null;
  tags: string[];
  licenseNote: string | null;
  durationMs: number | null;
  segCount: number;
  hasPoster: boolean;
  publishedAt: string | null;
  /** 当前用户已有的副本 id;没加过为 null */
  addedItemId: string | null;
}
export interface CatalogAdd {
  item: LibraryItem;
  created: boolean;
}

const enc = encodeURIComponent;

export async function listCatalog(api: ApiClient, signal?: AbortSignal): Promise<CatalogCard[]> {
  const reply = await api.request<{ items: CatalogCard[] }>("GET", "/api/library/catalog", { signal });
  return reply.items ?? [];
}

/** 幂等:已经添加过也返回 `{item, created: false}`。id 只出现在 URL 里。 */
export function addCatalogItem(api: ApiClient, id: string): Promise<CatalogAdd> {
  return api.request<CatalogAdd>("POST", `/api/library/catalog/${enc(id)}/add`, {});
}

export function fetchCatalogPoster(api: ApiClient, id: string, signal?: AbortSignal): Promise<Blob> {
  return api.request<Blob>("GET", `/api/library/catalog/${enc(id)}/poster`, { as: "blob", signal });
}
