/** 运行时设置的接口(B2/B3)。snake_case ↔ camelCase 只在这里转换,组件只见 camelCase。 */
import { request } from "../../api/client";
import type { Apply } from "../../components/apply-badge";

export type Kind = "str" | "text" | "int" | "float" | "bool" | "enum" | "csv" | "url" | "date" | "json" | "secret";
export type Scalar = string | number | boolean | null;
export type ValueSource = "env" | "override" | "default";

export interface SecretState {
  set: boolean;
  source: "env" | "override" | "none";
  fp: string;
}

export interface SettingItem {
  key: string;
  env: string;
  group: string;
  kind: Kind;
  label: string;
  help: string;
  apply: Apply;
  danger: string | null;
  envOnly: boolean;
  secret: boolean;
  managed: boolean;
  pair: string | null;
  min: number | null;
  max: number | null;
  choices: string[] | null;
  source: ValueSource;
  /** 非密钥 */
  default?: Scalar;
  envValue?: Scalar;
  override?: Scalar;
  effective?: Scalar;
  outOfRange?: boolean;
  /** 待重启时重启后的值(密钥为 true/false) */
  pending: Scalar;
  restartPending: boolean;
  /** 密钥 */
  envState?: SecretState;
  overrideState?: SecretState;
  effectiveState?: SecretState;
  invalid: string | null;
  drift: boolean;
}

export interface SettingsList {
  groups: [string, string][];
  items: SettingItem[];
  safeMode: boolean;
  encryption: boolean;
  revision: number;
  pendingRestart: string[];
  applyErrors: string[];
  invalid: Record<string, string>;
  rankRulesManaged: boolean;
}

export interface SaveResult {
  revision: number;
  changed: string[];
  pendingRestart: string[];
  applyErrors: string[];
}

export interface RevisionSide {
  source: "env" | "override";
  value?: Scalar;
  secret?: boolean;
}

export interface Revision {
  id: number;
  at: string;
  actor: string;
  reason: string;
  revertedBy: number | null;
  changes: { key: string; env: string; op: "set" | "reset"; old: RevisionSide; new: RevisionSide }[];
}

export interface RevisionPage {
  items: Revision[];
  nextBeforeId: number | null;
}

export type ImportStatus = "unknown" | "read_only" | "secret" | "invalid" | "unchanged" | "changed";

export interface ImportItem {
  env: string;
  key: string | null;
  status: ImportStatus;
  message?: string;
  old?: Scalar;
  new?: Scalar;
  danger?: string[];
}

export interface ImportPreview {
  items: ImportItem[];
  confirm: string | null;
}

export interface Finding {
  level: "error" | "warn" | "info";
  code: string;
  keys: string[];
  message: string;
}

export interface ProbeResult {
  ok: boolean;
  status: number;
  ms: number;
  code: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

function toSecret(raw: Raw | undefined): SecretState | undefined {
  return raw ? { set: !!raw.set, source: raw.source, fp: raw.fp ?? "" } : undefined;
}

export function toItem(raw: Raw, pendingKeys: string[] = []): SettingItem {
  return {
    key: raw.key,
    env: raw.env,
    group: raw.group,
    kind: raw.kind,
    label: raw.label,
    help: raw.help ?? "",
    apply: raw.apply,
    danger: raw.danger ?? null,
    envOnly: !!raw.env_only,
    secret: !!raw.secret,
    managed: !!raw.managed,
    pair: raw.pair ?? null,
    min: raw.min ?? null,
    max: raw.max ?? null,
    choices: raw.choices ?? null,
    source: raw.source,
    default: raw.default,
    envValue: raw.env_value,
    override: raw.override,
    effective: raw.effective,
    outOfRange: raw.out_of_range,
    pending: raw.pending ?? null,
    restartPending: pendingKeys.includes(raw.key),
    envState: toSecret(raw.env_state),
    overrideState: toSecret(raw.override_state),
    effectiveState: toSecret(raw.effective_state),
    invalid: raw.invalid ?? null,
    drift: !!raw.drift,
  };
}

export function toResult(raw: Raw): SaveResult {
  return {
    revision: raw.revision,
    changed: raw.changed ?? [],
    pendingRestart: raw.pending_restart ?? [],
    applyErrors: raw.apply_errors ?? [],
  };
}

export async function listSettings(): Promise<SettingsList> {
  const raw = await request<Raw>("/api/admin/settings");
  const pending: string[] = raw.pending_restart ?? [];
  return {
    groups: raw.groups,
    items: (raw.items as Raw[]).map((i) => toItem(i, pending)),
    safeMode: !!raw.safe_mode,
    encryption: !!raw.encryption,
    revision: raw.revision ?? 0,
    pendingRestart: pending,
    applyErrors: raw.apply_errors ?? [],
    invalid: raw.invalid ?? {},
    rankRulesManaged: !!raw.rank_rules_managed,
  };
}

export async function saveSettings(body: {
  changes: Record<string, Scalar>;
  reason?: string;
  confirm?: string | null;
  confirmPairs?: string[];
}): Promise<SaveResult> {
  const raw = await request<Raw>("/api/admin/settings", {
    method: "PATCH",
    json: { changes: body.changes, reason: body.reason ?? "", confirm: body.confirm || null, confirm_pairs: body.confirmPairs ?? [] },
  });
  return toResult(raw);
}

export async function resetSetting(key: string, reason: string, confirm?: string | null): Promise<SaveResult> {
  const raw = await request<Raw>(`/api/admin/settings/${encodeURIComponent(key)}`, {
    method: "DELETE",
    query: { reason, confirm: confirm || undefined },
  });
  return toResult(raw);
}

export async function listRevisions(beforeId?: number | null): Promise<RevisionPage> {
  const raw = await request<Raw>("/api/admin/settings/revisions", { query: { before_id: beforeId ?? undefined } });
  return {
    items: (raw.items as Raw[]).map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.actor,
      reason: r.reason ?? "",
      revertedBy: r.reverted_by ?? null,
      changes: r.changes ?? [],
    })),
    nextBeforeId: raw.next_before_id ?? null,
  };
}

export async function revertRevision(
  id: number,
  body: { reason: string; confirm?: string | null; acknowledgeConflicts?: boolean },
): Promise<SaveResult> {
  const raw = await request<Raw>(`/api/admin/settings/revisions/${id}/revert`, {
    method: "POST",
    json: { reason: body.reason, confirm: body.confirm || null, acknowledge_conflicts: !!body.acknowledgeConflicts },
  });
  return toResult(raw);
}

export function exportSettings(): Promise<Blob> {
  return request<Blob>("/api/admin/settings/export", { as: "blob" });
}

export async function importPreview(payload: unknown): Promise<ImportPreview> {
  const raw = await request<Raw>("/api/admin/settings/import/preview", { method: "POST", json: payload });
  return { items: raw.items ?? [], confirm: raw.confirm ?? null };
}

export async function importApply(payload: unknown, reason: string, confirm?: string | null): Promise<SaveResult> {
  const raw = await request<Raw>("/api/admin/settings/import/apply", {
    method: "POST",
    json: { payload, reason, confirm: confirm || null },
  });
  return toResult(raw);
}

export async function getDoctor(): Promise<{ findings: Finding[] }> {
  const raw = await request<Raw>("/api/admin/doctor");
  return { findings: raw.findings ?? [] };
}

export function runProbe(
  upstream: string,
  body: { values?: Record<string, Scalar>; allowCost?: boolean; confirmPairs?: string[] } = {},
): Promise<ProbeResult> {
  return request<ProbeResult>(`/api/admin/probes/${encodeURIComponent(upstream)}`, {
    method: "POST",
    json: { values: body.values ?? {}, allow_cost: !!body.allowCost, confirm_pairs: body.confirmPairs ?? [] },
  });
}
