/** 学习联动管理接口(learning links spec §9;服务端 routers/admin_links.py,计划 LA-1)。
 * wire 是 snake_case,这里转成 camelCase。计数是服务端单进程内存,重启清零。 */
import { request } from "../../api/client";

/** snake_case → camelCase(深层;features 之间不互相导入,所以不复用 wordbook 的同名函数)。 */
const camelKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
function camel<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camel(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[camelKey(k)] = camel(v);
    return out as T;
  }
  return value as T;
}

export type BreakerState = "closed" | "open" | "half_open";

export interface LinkCounters {
  published: number;
  handled: number;
  skipped: number;
  failed: number;
  timeouts: number;
  dropped: number;
  breakerSkipped: number;
  extra: Record<string, number>;
}

export interface LinkRow {
  key: string;
  labelZh: string;
  labelEn: string;
  global: boolean;
  effective: boolean;
  /** 有事件订阅(只有接口的联动为 false,计数显示「—」) */
  subscribed: boolean;
  stats: LinkCounters;
  breaker: BreakerState;
  openSeconds: number;
  usersOff: number;
}

export interface RankSourceRow {
  kind: string;
  defaultPoints: number;
  points: number;
  labelZh: string;
  labelEn: string;
}

/** 只有时间、联动键、事件类名、异常类名(永不含用户、词或文本) */
export interface LinkError {
  at: string;
  link: string;
  event: string;
  error: string;
}

export interface LinksView {
  enabled: boolean;
  queue: { size: number; max: number; dropped: number };
  links: LinkRow[];
  rankSources: RankSourceRow[];
  errors: LinkError[];
  processLocal: boolean;
}

export const fetchLinks = async (): Promise<LinksView> => camel<LinksView>(await request<unknown>("/api/admin/links"));

export const resetBreaker = (key: string) =>
  request<{ key: string; state: "closed" }>(`/api/admin/links/${encodeURIComponent(key)}/reset-breaker`, { method: "POST" });
