/** 审计日志接口(B6)。snake_case ↔ camelCase 只在这里转换。 */
import { request } from "../../api/client";

export type AuditResult = "ok" | "denied" | "error";

export interface AuditItem {
  id: number;
  at: string;
  actor: string;
  role: string;
  ip: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  result: AuditResult;
}

export interface AuditPage {
  items: AuditItem[];
  nextBeforeId: number | null;
}

export interface AuditFilters {
  actor?: string;
  actionPrefix?: string;
  targetType?: string;
  targetId?: string;
  beforeId?: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const toItem = (r: Raw): AuditItem => ({
  id: r.id,
  at: r.at,
  actor: r.actor,
  role: r.role,
  ip: r.ip,
  action: r.action,
  targetType: r.target_type ?? null,
  targetId: r.target_id ?? null,
  summary: r.summary ?? "",
  before: r.before ?? null,
  after: r.after ?? null,
  reason: r.reason ?? null,
  result: r.result,
});

export async function listAudit(f: AuditFilters = {}): Promise<AuditPage> {
  const raw = await request<Raw>("/api/admin/audit", {
    query: {
      actor: f.actor?.trim() || undefined,
      action_prefix: f.actionPrefix || undefined,
      target_type: f.targetType?.trim() || undefined,
      target_id: f.targetId?.trim() || undefined,
      before_id: f.beforeId ?? undefined,
    },
  });
  return { items: (raw.items as Raw[]).map(toItem), nextBeforeId: raw.next_before_id ?? null };
}

export async function verifyAudit(): Promise<{ ok: boolean; brokenAt: number | null }> {
  const raw = await request<Raw>("/api/admin/audit/verify");
  return { ok: !!raw.ok, brokenAt: raw.broken_at ?? null };
}
