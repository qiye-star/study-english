/** 管理员账号、会话、本人 TOTP/密码的接口(B5)。snake_case ↔ camelCase 只在这里转换。 */
import { request } from "../../api/client";
import type { Role } from "../../api/session";

export interface AdminAccount {
  id: number | null;
  username: string;
  role: Role;
  env: boolean;
  totp: boolean;
  disabled: boolean;
  createdBy: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
}

export interface AdminSessionRow {
  id: string;
  username: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
  env: boolean;
}

export interface MySecurity {
  username: string;
  role: Role;
  env: boolean;
  totpEnabled: boolean;
  encryption: boolean;
  requireTotp: boolean;
  recoveryCodesLeft: number | null;
}

export interface TotpEnrolment {
  secret: string;
  uri: string;
  enrolment: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const toAccount = (r: Raw): AdminAccount => ({
  id: r.id ?? null,
  username: r.username,
  role: r.role,
  env: !!r.env,
  totp: !!r.totp,
  disabled: !!r.disabled,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at ?? null,
  lastLoginAt: r.last_login_at ?? null,
});

const toSessionRow = (r: Raw): AdminSessionRow => ({
  id: r.id,
  username: r.username,
  ip: r.ip,
  userAgent: r.user_agent ?? "",
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  expiresAt: r.expires_at,
  current: !!r.current,
  env: !!r.env,
});

export async function listAccounts(): Promise<AdminAccount[]> {
  const raw = await request<Raw>("/api/admin/accounts");
  return (raw.accounts as Raw[]).map(toAccount);
}

export async function createAccount(body: { username: string; password: string; role: Role }): Promise<AdminAccount> {
  return toAccount(await request<Raw>("/api/admin/accounts", { method: "POST", json: body }));
}

export async function updateAccount(id: number, body: { role?: Role; disabled?: boolean; password?: string }): Promise<AdminAccount> {
  return toAccount(await request<Raw>(`/api/admin/accounts/${id}`, { method: "PATCH", json: body }));
}

export async function resetTotp(id: number): Promise<AdminAccount> {
  return toAccount(await request<Raw>(`/api/admin/accounts/${id}/reset-totp`, { method: "POST", json: {} }));
}

export async function listSessions(all = false): Promise<AdminSessionRow[]> {
  const raw = await request<Raw>("/api/admin/sessions", { query: { all: all ? 1 : undefined } });
  return (raw.sessions as Raw[]).map(toSessionRow);
}

export function revokeSession(id: string): Promise<void> {
  return request<void>(`/api/admin/sessions/${encodeURIComponent(id)}`, { method: "DELETE", as: "none" });
}

export async function getMySecurity(): Promise<MySecurity> {
  const r = await request<Raw>("/api/admin/me/security");
  return {
    username: r.username,
    role: r.role,
    env: !!r.env,
    totpEnabled: !!r.totp_enabled,
    encryption: !!r.encryption,
    requireTotp: !!r.require_totp,
    recoveryCodesLeft: r.recovery_codes_left ?? null,
  };
}

export function beginTotp(): Promise<TotpEnrolment> {
  return request<TotpEnrolment>("/api/admin/me/totp/begin", { method: "POST", json: {} });
}

export async function confirmTotp(enrolment: string, code: string): Promise<string[]> {
  const r = await request<Raw>("/api/admin/me/totp/confirm", { method: "POST", json: { enrolment, code } });
  return r.recovery_codes ?? [];
}

export function disableTotp(): Promise<void> {
  return request<void>("/api/admin/me/totp", { method: "DELETE", as: "none" });
}

export function changePassword(current: string, next: string): Promise<void> {
  return request<void>("/api/admin/me/password", { method: "POST", json: { current, new: next }, as: "none" });
}
