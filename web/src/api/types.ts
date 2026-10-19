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

/**
 * 「我的邀请码」的原因(server `user_invites`):`invites_disabled` = 上限为 0(邀请权已收回,码不显示);
 * `rotate_required` = 有码但无法显示(密钥变更),资格仍为 true,需要更换。
 */
export type MyInviteReason =
  | "too_new"
  | "email_unverified"
  | "disabled_by_admin"
  | "invites_disabled"
  | "rotate_required";

/** `GET/POST /api/me/invite`、`POST /api/me/invite/rotate` 的形状(服务端 `user_invites.view`,R-I6、R-I9)。 */
export interface MyInvite {
  eligible: boolean;
  /** 不合格或需要更换时的原因;合格且正常时为 null。 */
  reason: MyInviteReason | null;
  /** 仅 `too_new` 时有:最早可以生成的时间(带时区 ISO)。 */
  availableAt: string | null;
  /** 没有码、或码不显示(不合格)时为 null。 */
  code: string | null;
  /** 累计使用次数(更换不清零,R-I8)。 */
  uses: number;
  /** 累计上限;0 表示邀请权已收回。 */
  cap: number;
  invitees: InviteeInfo[];
}
