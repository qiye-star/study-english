/** 用户治理、配额覆盖、邀请码的接口(lane community D5)。wire 是 snake_case,这里转成 camelCase。 */
import { request } from "../../api/client";
import type { UserSummary } from "../../api/types";

type Id = string | number;
const enc = (id: Id) => encodeURIComponent(String(id));
const PER_PAGE = 20;

export type UserStatusFilter = "all" | "active" | "disabled";
export type UserSort = "recent" | "created" | "storage";
export type UserRow = UserSummary & { disabled_at?: string | null };

export interface UserListFilters {
  status: UserStatusFilter;
  sort: UserSort;
}

export const listUsers = (q: string, page: number, filters: UserListFilters) =>
  request<{ users: UserRow[]; page: number; next: number | null; total: number }>("/api/admin/users", {
    query: { q: q.trim() || undefined, page, per_page: PER_PAGE, status: filters.status, sort: filters.sort },
  });

export interface UserStatus {
  id: string;
  username: string;
  disabledAt: string | null;
}

export async function getUserStatus(id: Id): Promise<UserStatus> {
  const u = await request<{ id: string | number; username: string; disabled_at?: string | null }>(`/api/admin/users/${enc(id)}`);
  return { id: String(u.id), username: u.username, disabledAt: u.disabled_at ?? null };
}

export interface DisableResult {
  userId: number;
  disabledAt: string | null;
  revoked: number;
}

async function setDisabled(id: Id, action: "disable" | "enable", reason: string): Promise<DisableResult> {
  const r = await request<{ user_id: number; disabled_at: string | null; revoked: number }>(
    `/api/admin/users/${enc(id)}/${action}`,
    { method: "POST", json: { reason } },
  );
  return { userId: r.user_id, disabledAt: r.disabled_at, revoked: r.revoked };
}

export const disableUser = (id: Id, reason: string) => setDisabled(id, "disable", reason);
export const enableUser = (id: Id, reason: string) => setDisabled(id, "enable", reason);

export async function revokeTokens(id: Id): Promise<number> {
  return (await request<{ revoked: number }>(`/api/admin/users/${enc(id)}/revoke-tokens`, { method: "POST" })).revoked;
}

/** 临时密码只在这次响应里出现;调用方只放进结果对话框,不记录、不缓存。 */
export async function resetPassword(id: Id): Promise<string> {
  return (await request<{ password: string }>(`/api/admin/users/${enc(id)}/reset-password`, { method: "POST" })).password;
}

/** 超级管理员 + 二次验证(服务端 403 Step-up required 时客户端弹框后重放)。 */
export const deleteUser = (id: Id, confirmUsername: string, reason: string) =>
  request<{ deleted: number; recordings_bytes: number }>(`/api/admin/users/${enc(id)}`, {
    method: "DELETE",
    json: { confirm_username: confirmUsername, reason },
  });

export interface QuotaItem {
  key: string;
  setting: string;
  default: number;
  override: number | null;
  expired?: boolean;
  expiresAt: string | null;
  note: string;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

interface QuotaWire {
  key: string;
  setting: string;
  default: number;
  override: number | null;
  expired: boolean;
  expires_at: string | null;
  note: string;
  updated_by: string | null;
  updated_at: string | null;
}

const quotaIn = (w: QuotaWire): QuotaItem => ({
  key: w.key, setting: w.setting, default: w.default, override: w.override, expired: w.expired,
  expiresAt: w.expires_at, note: w.note, updatedBy: w.updated_by, updatedAt: w.updated_at,
});

export async function getQuotas(id: Id): Promise<{ items: QuotaItem[] }> {
  const r = await request<{ items: QuotaWire[] }>(`/api/admin/users/${enc(id)}/quotas`);
  return { items: r.items.map(quotaIn) };
}

export async function setQuota(id: Id, key: string, body: { value: number; expiresAt: string | null; note: string }): Promise<void> {
  await request(`/api/admin/users/${enc(id)}/quotas/${encodeURIComponent(key)}`, {
    method: "PUT",
    json: { value: body.value, expires_at: body.expiresAt, note: body.note },
  });
}

export async function clearQuota(id: Id, key: string): Promise<void> {
  await request(`/api/admin/users/${enc(id)}/quotas/${encodeURIComponent(key)}`, { method: "DELETE", as: "none" });
}

export type InviteState = "active" | "used_up" | "expired" | "revoked";

export interface Invite {
  id: number;
  label: string;
  uses: number;
  maxUses: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
  state: InviteState;
}

interface InviteWire {
  id: number;
  label: string;
  uses: number;
  max_uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
  state: InviteState;
}

const inviteIn = (w: InviteWire): Invite => ({
  id: w.id, label: w.label, uses: w.uses, maxUses: w.max_uses, expiresAt: w.expires_at, revokedAt: w.revoked_at,
  createdBy: w.created_by, createdAt: w.created_at, state: w.state,
});

export async function listInvites(): Promise<Invite[]> {
  return (await request<{ invites: InviteWire[] }>("/api/admin/invites")).invites.map(inviteIn);
}

/** 明文码只在这次响应里出现一次。 */
export async function createInvite(body: { label: string; maxUses: number; expiresAt: string | null }): Promise<{ invite: Invite; code: string }> {
  const r = await request<{ invite: InviteWire; code: string }>("/api/admin/invites", {
    method: "POST",
    json: { label: body.label, max_uses: body.maxUses, expires_at: body.expiresAt },
  });
  return { invite: inviteIn(r.invite), code: r.code };
}

export async function revokeInvite(id: number): Promise<void> {
  await request(`/api/admin/invites/${id}`, { method: "DELETE", as: "none" });
}
