/** 跟读库管理接口(spec 2026-10-13-video-import §12;服务端 routers/admin_library.py)。wire 是 snake_case,这里转 camelCase。
 * 管理员看不到标题、网址与文字(E10):这里的类型里也没有这些字段。 */
import { request } from "../../api/client";

export type LibraryStatus = "uploading" | "queued" | "processing" | "ready" | "failed" | "canceled";
export type LibraryKind = "audio" | "video";
export type StatusFilter = LibraryStatus | "all";
export type KindFilter = LibraryKind | "all";

export const LIBRARY_STATUSES: LibraryStatus[] = ["uploading", "queued", "processing", "ready", "failed", "canceled"];
/** 可以取消的状态(与服务端 library_admin.CANCELLABLE 一致) */
export const CANCELLABLE: LibraryStatus[] = ["uploading", "queued", "processing"];

export interface LibraryOverview {
  enabled: boolean;
  available: boolean;
  asr: { enabled: boolean; available: boolean; todayMinutes: number; globalDailyMinutes: number };
  /** D8:译文与分析(R-A19);今日数字是句数,来自服务端的每日用量,不含任何句子文字 */
  ai: {
    enabled: boolean;
    available: boolean;
    todayTranslated: number;
    todayAnalysed: number;
    globalDaily: number;
    translateDailyPerUser: number;
    analysisDailyPerUser: number;
  };
  link: { enabled: boolean; available: boolean; allowGeneric: boolean; cookiesConfigured: boolean; proxyConfigured: boolean };
  tools: { ffmpeg: string | null; ytdlp: string | null };
  totals: { items: number; bytes: number; users: number };
  byStatus: Record<LibraryStatus, number>;
  queue: { queued: number; processing: number; running: number; concurrency: number };
  limits: { quotaMb: number; maxItems: number; maxUploadMb: number; maxDurationMinutes: number };
  purgeConfirm: string;
}

export interface LibraryRow {
  id: string;
  userId: number;
  username: string | null;
  kind: LibraryKind;
  source: "upload" | "link";
  status: LibraryStatus;
  stage: string | null;
  progress: number;
  errorKind: string | null;
  durationMs: number | null;
  bytes: number;
  subSource: string | null;
  sourceHost: string | null;
  createdAt: string;
}

export interface LibraryItemsPage { items: LibraryRow[]; page: number; next: number | null; total: number }
export interface LibraryTopUser { userId: number; username: string | null; items: number; bytes: number }
export interface UserLibraryUsageData {
  userId: number; enabled: boolean; items: number; bytes: number; quotaMb: number; maxItems: number;
  byStatus: Record<LibraryStatus, number>;
}
export interface ItemFilters { status: StatusFilter; kind: KindFilter; userId: string | null }

/** snake_case → camelCase(深层;与 features/wordbook/api.ts 相同,不跨 feature 导入)。 */
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

/** 单条删除要原样输入的短语(服务端 library_admin.delete_phrase) */
export const deletePhrase = (id: string) => `DELETE ${id.slice(0, 8)}`;

const enc = encodeURIComponent;

export const fetchLibraryOverview = async (): Promise<LibraryOverview> =>
  camel<LibraryOverview>(await request<unknown>("/api/admin/library"));

export const fetchLibraryItems = async (f: ItemFilters, page = 1): Promise<LibraryItemsPage> =>
  camel<LibraryItemsPage>(
    await request<unknown>("/api/admin/library/items", {
      query: {
        status: f.status === "all" ? undefined : f.status,
        kind: f.kind === "all" ? undefined : f.kind,
        user_id: f.userId ?? undefined,
        page,
      },
    }),
  );

export const fetchTopUsers = async (): Promise<{ users: LibraryTopUser[] }> =>
  camel<{ users: LibraryTopUser[] }>(await request<unknown>("/api/admin/library/top-users"));

export const fetchUserLibrary = async (userId: string): Promise<UserLibraryUsageData> =>
  camel<UserLibraryUsageData>(await request<unknown>(`/api/admin/library/users/${enc(userId)}`));

export const deleteLibraryItem = (id: string, reason: string, confirm: string) =>
  request<{ deleted: string; bytes: number }>(`/api/admin/library/items/${enc(id)}/delete`, { method: "POST", json: { reason, confirm } });

export const cancelLibraryItem = (id: string, reason: string) =>
  request<{ id: string; status: string }>(`/api/admin/library/items/${enc(id)}/cancel`, { method: "POST", json: { reason } });

export const purgeFailedItems = (reason: string, confirm: string) =>
  request<{ deleted: number; bytes: number; more: boolean }>("/api/admin/library/purge-failed", { method: "POST", json: { reason, confirm } });
