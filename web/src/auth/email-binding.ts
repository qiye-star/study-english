import type { EmailBindingInfo, UserProfile } from "~/api/types";

/**
 * 绑定页的路由(X26)。强制绑定时 RequireAuth 把其他页面都挡到这里。
 * 鉴权层不导入 features/account;账号 feature 用同一个常量接线,两边都只依赖这里。
 */
export const EMAIL_BINDING_PATH = "/account/email";

export interface EmailStatus {
  /** 脱敏邮箱;未绑定为 null。 */
  masked: string | null;
  verified: boolean;
  binding: EmailBindingInfo;
}

export function emailStatusOf(profile: UserProfile): EmailStatus {
  return {
    masked: profile.emailMasked ?? null,
    verified: profile.emailVerified === true,
    binding: profile.emailBinding ?? { state: "none", deadline: null },
  };
}

/** 强制绑定已开启且本账号还没有验证过的邮箱。 */
export function bindingRequiredOf(status: EmailStatus): boolean {
  return status.binding.state === "enforced" && !status.verified;
}
