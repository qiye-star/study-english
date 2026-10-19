export interface AuthUser {
  id: string;
  name: string;
  createdAt: string;
  accessToken: string;
  /** 可缺省:没有昵称时服务端不返回该字段。 */
  nickname?: string;
  /** 服务端上线后才有;缺省时用 `name`(见 displayNameOf)。 */
  displayName?: string;
}

export interface UserProfile {
  id: string;
  /** 登录名(username),与 `name` 同值。 */
  name: string;
  createdAt: string;
  /** 可缺省:没有昵称时服务端不返回。 */
  nickname?: string;
  /** 可缺省:服务端上线后才有;缺省时用 `name`(见 displayNameOf)。 */
  displayName?: string;
}

/** 网页上显示的名字:`displayName ?? name`。全站只用这一处回退逻辑。 */
export function displayNameOf(user: { name: string; displayName?: string | null }): string {
  return user.displayName || user.name;
}

/** 发码接口的回执(同时适用于注册 / 找回与绑定):无论邮箱是否已注册,形状相同。 */
export interface EmailCodeReceipt {
  ok: boolean;
  cooldownSeconds: number;
}

export interface RegisterInput {
  username: string;
  password: string;
  inviteCode?: string;
  /** 邮箱必填(开关开启时):与 `emailCode` 一起提交。 */
  email?: string;
  emailCode?: string;
  nickname?: string;
}

export type Paged<K extends string, T> = { page: number; next: number | null } & Record<K, T[]>;
