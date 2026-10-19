import type { ApiClient } from "~/api/client";
import type { UserProfile } from "~/api/types";
import { normalizeEmail } from "~/auth/validation";

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
export function requestEmailCode(api: ApiClient, email: string, purpose: "register" | "reset") {
  return api.sendEmailCode(normalizeEmail(email), purpose);
}

/** 找回密码:成功后不返回 token,页面跳回登录页。 */
export function resetPassword(api: ApiClient, input: { email: string; code: string; newPassword: string }) {
  return api.resetPassword({ ...input, email: normalizeEmail(input.email) });
}
