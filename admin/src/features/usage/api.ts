import { request } from "../../api/client";

/** 用量与估算费用(GET /api/admin/usage/*,viewer)。服务端字段是 snake_case,这里转成 camelCase。 */

export type UsageDays = 1 | 7 | 30 | 90;
export const USAGE_DAYS: UsageDays[] = [1, 7, 30, 90];
export type ErrorBucket = "402" | "429" | "auth" | "5xx" | "network";
export const ERROR_BUCKETS: ErrorBucket[] = ["402", "429", "auth", "5xx", "network"];

export interface UsageTotals {
  calls: number;
  errors: number;
  errorRate: number;
  /** 估算费用(已定价部分之和) */
  cost: number;
  /** false = 有调用缺单价或无法估算(字节计量) */
  costComplete: boolean;
  p50Ms: number | null;
  p95Ms: number | null;
  activeUsers: number;
}

export interface FeatureRow {
  feature: string;
  calls: number;
  errors: number;
  cost: number | null;
}

export interface ModelRow {
  kind: string;
  provider: string;
  model: string;
  unit: string;
  calls: number;
  unitsIn: number;
  unitsOut: number;
  cost: number | null;
}

export interface DailyRow {
  day: string;
  calls: number;
  errors: number;
  cost: number | null;
  /** 功能 → 调用数 */
  features: Record<string, number>;
}

export interface UsageSummary {
  days: number;
  currency: string;
  totals: UsageTotals;
  byFeature: FeatureRow[];
  byModel: ModelRow[];
  daily: DailyRow[];
  errors: Record<ErrorBucket, number>;
}

export interface TopUser {
  userId: number;
  username: string | null;
  calls: number;
  cost: number | null;
}

export interface HealthRow {
  kind: string;
  provider: string;
  calls: number;
  errors: number;
  successRate: number | null;
  lastErrorStatus: number | null;
  lastErrorAt: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSummary(raw: any): UsageSummary {
  const t = raw.totals ?? {};
  return {
    days: raw.days,
    currency: raw.currency,
    totals: {
      calls: t.calls ?? 0,
      errors: t.errors ?? 0,
      errorRate: t.error_rate ?? 0,
      cost: t.cost ?? 0,
      costComplete: !!t.cost_complete,
      p50Ms: t.p50_ms ?? null,
      p95Ms: t.p95_ms ?? null,
      activeUsers: t.active_users ?? 0,
    },
    byFeature: (raw.by_feature ?? []).map((f: any) => ({ feature: f.feature, calls: f.calls, errors: f.errors, cost: f.cost ?? null })),
    byModel: (raw.by_model ?? []).map((m: any) => ({
      kind: m.kind,
      provider: m.provider,
      model: m.model,
      unit: m.unit,
      calls: m.calls,
      unitsIn: m.units_in ?? 0,
      unitsOut: m.units_out ?? 0,
      cost: m.cost ?? null,
    })),
    daily: (raw.daily ?? []).map((d: any) => ({ day: d.day, calls: d.calls, errors: d.errors, cost: d.cost ?? null, features: d.features ?? {} })),
    errors: { "402": 0, "429": 0, auth: 0, "5xx": 0, network: 0, ...(raw.errors ?? {}) },
  };
}

export async function getSummary(days: UsageDays): Promise<UsageSummary> {
  return toSummary(await request<any>("/api/admin/usage/summary", { query: { days } }));
}

export async function getTopUsers(days: UsageDays, by: "cost" | "calls"): Promise<TopUser[]> {
  const raw = await request<{ items: any[] }>("/api/admin/usage/top-users", { query: { days, by } });
  return raw.items.map((u) => ({ userId: u.user_id, username: u.username ?? null, calls: u.calls, cost: u.cost ?? null }));
}

export async function getHealth(): Promise<HealthRow[]> {
  const raw = await request<{ items: any[] }>("/api/admin/usage/health");
  return raw.items.map((h) => ({
    kind: h.kind,
    provider: h.provider,
    calls: h.calls,
    errors: h.errors,
    successRate: h.success_rate ?? null,
    lastErrorStatus: h.last_error_status ?? null,
    lastErrorAt: h.last_error_at ?? null,
  }));
}
