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

export type Paged<K extends string, T> = { page: number; next: number | null } & Record<K, T[]>;
