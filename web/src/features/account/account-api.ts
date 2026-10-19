import type { ApiClient } from "~/api/client";
import type { UserProfile } from "~/api/types";
import { normalizeEmail } from "~/auth/validation";

/** 发码接口的回执(注册 / 找回与绑定共用):无论邮箱是否已注册,形状相同。 */
export interface EmailCodeReceipt {
  ok: boolean;
  cooldownSeconds: number;
}

/** 账号接口的服务端文案 → 账号区的键(X37:只随账号懒加载包进入;通用文案仍走 api/error-messages)。 */
export const ACCOUNT_ERROR_KEYS: Record<string, string> = {
  "Invalid or expired code": "web.account.errors.invalidCode",
  "Too many codes, please wait": "web.account.errors.tooManyCodes",
  "Email temporarily unavailable": "web.account.errors.emailUnavailable",
  "Email domain not allowed": "web.account.errors.emailDomainNotAllowed",
  "Email is not configured": "web.account.errors.emailNotConfigured",
  "Wrong password": "web.account.password.wrong",
  "Email already bound": "web.account.errors.emailAlreadyBound",
  "Email verification required: please register in the web app": "web.account.errors.emailVerificationRequired",
};

/** 「账号」区读取资料(昵称)。组件只经过这里与 ApiClient 打交道,不直接 fetch。 */
export function fetchProfile(api: ApiClient): Promise<UserProfile> {
  return api.me();
}

/** 改昵称;去掉首尾空白,空白即清除昵称(服务端回到登录名)。 */
export function saveNickname(api: ApiClient, value: string): Promise<{ nickname: string | null; displayName: string }> {
  const nickname = value.trim();
  return api.updateMe({ nickname: nickname === "" ? null : nickname });
}

/** 注册 / 找回密码发码(邮箱规范化后发出;回执与邮箱是否已注册无关)。 */
export function requestEmailCode(api: ApiClient, email: string, purpose: "register" | "reset"): Promise<EmailCodeReceipt> {
  return api.request("POST", "/api/email/code", { json: { email: normalizeEmail(email), purpose }, auth: false });
}

/** 已登录用户的绑定 / 换绑发码(强制绑定期间也可用)。 */
export function requestBindCode(api: ApiClient, email: string, purpose: "bind" | "change_email"): Promise<EmailCodeReceipt> {
  return api.request("POST", "/api/me/email/code", { json: { email: normalizeEmail(email), purpose } });
}

/** 绑定 / 换绑邮箱;换绑必须带当前密码。 */
export async function bindEmail(api: ApiClient, input: { email: string; code: string; password?: string }): Promise<void> {
  await api.request("POST", "/api/me/email", { json: { ...input, email: normalizeEmail(input.email) } });
}

/** 找回密码:成功后不返回 token,页面跳回登录页。 */
export async function resetPassword(api: ApiClient, input: { email: string; code: string; newPassword: string }): Promise<void> {
  await api.request("POST", "/api/password/reset", { json: { ...input, email: normalizeEmail(input.email) }, auth: false });
}
