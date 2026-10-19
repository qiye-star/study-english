import type { ApiClient } from "~/api/client";
import type { UserProfile } from "~/api/types";

/** 「账号」区读取资料(昵称)。组件只经过这里与 ApiClient 打交道,不直接 fetch。 */
export function fetchProfile(api: ApiClient): Promise<UserProfile> {
  return api.me();
}

/** 改昵称;去掉首尾空白,空白即清除昵称(服务端回到登录名)。 */
export function saveNickname(api: ApiClient, value: string): Promise<{ nickname: string | null; displayName: string }> {
  const nickname = value.trim();
  return api.updateMe({ nickname: nickname === "" ? null : nickname });
}
