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

/** 邮箱绑定状态(X26):`pending` 有截止时间;`enforced` 表示已强制绑定,未绑定则不能继续使用。 */
export interface EmailBindingInfo {
  state: "none" | "pending" | "enforced";
  /** 带时区的 ISO 字符串(X12);没有截止时间时为 null。 */
  deadline?: string | null;
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
  /** 脱敏邮箱(a***@example.com);未绑定为 null。可缺省。 */
  emailMasked?: string | null;
  /** 邮箱已验证(绑定完成)。可缺省,缺省视为未验证。 */
  emailVerified?: boolean;
  /** 可缺省,缺省视为 `none`。 */
  emailBinding?: EmailBindingInfo;
}

/** 网页上显示的名字:`displayName ?? name`。全站只用这一处回退逻辑。 */
export function displayNameOf(user: { name: string; displayName?: string | null }): string {
  return user.displayName || user.name;
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

/** 「我的邀请码」的一位被邀请者:只有显示名与兑换时间(无邮箱、无 id;INDEX X34 显示名来自服务端)。 */
export interface InviteeInfo {
  displayName: string;
  /** 带时区的 ISO 字符串(X12)。 */
  joinedAt: string;
}

/** 不合格原因(R-I6):`invites_disabled` = 管理员把该用户的上限覆盖为 0(邀请权已收回)。 */
export type MyInviteReason = "too_new" | "email_unverified" | "disabled_by_admin" | "invites_disabled";

/** `GET/POST /api/me/invite`、`POST /api/me/invite/rotate` 的形状(R-I6、R-I9)。 */
export type MyInvite =
  | { eligible: false; reason: MyInviteReason; availableAt: string | null }
  | {
      eligible: true;
      /** 没有码时缺省或为 null。 */
      code?: string | null;
      /** 累计使用次数(更换不清零,R-I8)。 */
      uses: number;
      /** 累计上限。 */
      cap: number;
      invitees: InviteeInfo[];
    };
