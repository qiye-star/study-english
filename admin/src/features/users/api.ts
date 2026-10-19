/** 用户治理、配额覆盖、邀请码的接口(lane community D5)。wire 是 snake_case,这里转成 camelCase。 */
import { request } from "../../api/client";
import type { UserSummary } from "../../api/types";

type Id = string | number;
const enc = (id: Id) => encodeURIComponent(String(id));
const PER_PAGE = 20;

export type UserStatusFilter = "all" | "active" | "disabled";
export type UserSort = "recent" | "created" | "storage";
export type UserEmailFilter = "all" | "bound" | "unbound";
export type UserRow = UserSummary & { disabled_at?: string | null };

export interface UserListFilters {
  status: UserStatusFilter;
  sort: UserSort;
  email: UserEmailFilter;
}

export const listUsers = (q: string, page: number, filters: UserListFilters) =>
  request<{ users: UserRow[]; page: number; next: number | null; total: number }>("/api/admin/users", {
    query: { q: q.trim() || undefined, page, per_page: PER_PAGE, status: filters.status, sort: filters.sort, email: filters.email },
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

export interface EmailClearResult {
  userId: number;
  emailMasked: string | null;
  emailVerified: boolean;
}

/** 清除用户邮箱(operator + 二次验证;不撤销现有登录令牌)。 */
export async function clearUserEmail(id: Id, reason: string): Promise<EmailClearResult> {
  const r = await request<{ user_id: number; email_masked: string | null; email_verified: boolean }>(
    `/api/admin/users/${enc(id)}/email/clear`,
    { method: "POST", json: { reason } },
  );
  return { userId: r.user_id, emailMasked: r.email_masked, emailVerified: r.email_verified };
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
export type InviteKind = "admin" | "user";

/** 用户码的所有者(登录名为主;昵称只作辅助显示,X6)。管理员码没有所有者。 */
export interface InviteOwner {
  id: number;
  username: string;
  nickname: string | null;
}

/** 兑换人数是精确计数;名字最多 5 个(最新在前)。 */
export interface InviteRedeemers {
  total: number;
  usernames: string[];
}

export interface Invite {
  id: number;
  label: string;
  kind: InviteKind;
  uses: number;
  /** 管理员码为本码上限;用户码为该用户的累计上限(实时配额)。 */
  maxUses: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
  state: InviteState;
  owner: InviteOwner | null;
  redeemers: InviteRedeemers;
}

interface InviteWire {
  id: number;
  label: string;
  kind: InviteKind;
  uses: number;
  max_uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
  state: InviteState;
  /** 只有列表(GET /api/admin/invites)返回;新建接口不带。 */
  owner?: { id: number; username: string; nickname: string | null } | null;
  redeemers?: InviteRedeemers;
}

const NO_REDEEMERS: InviteRedeemers = { total: 0, usernames: [] };

const inviteIn = (w: InviteWire): Invite => ({
  id: w.id, label: w.label, kind: w.kind, uses: w.uses, maxUses: w.max_uses, expiresAt: w.expires_at,
  revokedAt: w.revoked_at, createdBy: w.created_by, createdAt: w.created_at, state: w.state,
  owner: w.owner ?? null, redeemers: w.redeemers ?? NO_REDEEMERS,
});

export interface InviteFilter {
  /** 缺省或 "all" 不筛选。 */
  kind?: InviteKind | "all";
  /** 登录名或用户 id;空白不筛选。 */
  owner?: string;
  state?: InviteState | "all";
}

export async function listInvites(filter: InviteFilter = {}): Promise<Invite[]> {
  const r = await request<{ invites: InviteWire[] }>("/api/admin/invites", {
    query: {
      kind: filter.kind && filter.kind !== "all" ? filter.kind : undefined,
      owner: filter.owner?.trim() || undefined,
      state: filter.state && filter.state !== "all" ? filter.state : undefined,
    },
  });
  return r.invites.map(inviteIn);
}

/** 明文码只在这次响应里出现一次。 */
export async function createInvite(body: { label: string; maxUses: number; expiresAt: string | null }): Promise<{ invite: Invite; code: string }> {
  const r = await request<{ invite: InviteWire; code: string }>("/api/admin/invites", {
    method: "POST",
    json: { label: body.label, max_uses: body.maxUses, expires_at: body.expiresAt },
  });
  return { invite: inviteIn(r.invite), code: r.code };
}

/** 批量一次性码(1–100,每个 max_uses = 1)。明文码只在这次响应里出现;CSV 在浏览器里生成,服务端不导出。 */
export async function createInviteBatch(body: { count: number; label: string; expiresAt: string | null }): Promise<{ invites: Invite[]; codes: string[] }> {
  const r = await request<{ invites: InviteWire[]; codes: string[] }>("/api/admin/invites/batch", {
    method: "POST",
    json: { count: body.count, label: body.label, expires_at: body.expiresAt },
  });
  return { invites: r.invites.map(inviteIn), codes: r.codes };
}

export async function revokeInvite(id: number): Promise<void> {
  await request(`/api/admin/invites/${id}`, { method: "DELETE", as: "none" });
}

export interface Redemption {
  userId: number | null;
  username: string | null;
  nickname: string | null;
  redeemedAt: string;
  disabled: boolean;
}

/** 谁用过这个码(新在前)。已删除的兑换者保留一行,身份字段为空(R-I11)。 */
export async function listRedemptions(id: number): Promise<Redemption[]> {
  const r = await request<{ redemptions: Array<{ user_id: number | null; username: string | null; nickname: string | null; redeemed_at: string; disabled: boolean }> }>(
    `/api/admin/invites/${id}/redemptions`,
  );
  return r.redemptions.map((x) => ({ userId: x.user_id, username: x.username, nickname: x.nickname, redeemedAt: x.redeemed_at, disabled: x.disabled }));
}

/** 用户的邀请码状态:只有用量与计数,从不包含码本身(R-I10)。 */
export interface UserInviteStatus {
  current: { uses: number; cap: number; createdAt: string; revokedAt: string | null; state: InviteState } | null;
  historyCodes: number;
  redemptions: number;
  disabledInvitees: number;
  invitees: Array<{ displayName: string; redeemedAt: string; disabled: boolean }>;
}

export async function getUserInvite(id: Id): Promise<UserInviteStatus> {
  const r = await request<{
    current: { uses: number; cap: number; created_at: string; revoked_at: string | null; state: InviteState } | null;
    history_codes: number;
    redemptions: number;
    disabled_invitees: number;
    invitees: Array<{ display_name: string; redeemed_at: string; disabled: boolean }>;
  }>(`/api/admin/users/${enc(id)}/invite`);
  return {
    current: r.current && { uses: r.current.uses, cap: r.current.cap, createdAt: r.current.created_at, revokedAt: r.current.revoked_at, state: r.current.state },
    historyCodes: r.history_codes,
    redemptions: r.redemptions,
    disabledInvitees: r.disabled_invitees,
    invitees: r.invitees.map((x) => ({ displayName: x.display_name, redeemedAt: x.redeemed_at, disabled: x.disabled })),
  };
}

/** 收回用户当前的码(operator + 二次验证;原因必填,写入审计)。 */
export const revokeUserInvite = (id: Id, reason: string) =>
  request(`/api/admin/users/${enc(id)}/invite/revoke`, { method: "POST", json: { reason }, as: "none" });

/** 更换用户的码:旧码立即失效,新码沿用已用次数且只显示给用户本人(管理员看不到)。 */
export const rotateUserInvite = (id: Id, reason: string) =>
  request(`/api/admin/users/${enc(id)}/invite/rotate`, { method: "POST", json: { reason }, as: "none" });
