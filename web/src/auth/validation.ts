export const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** R-F1:去首尾空白、转小写(服务端同样规范化)。 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** 登录框:含 @ 的按邮箱规范化,其余按用户名(服务端按同样的规则查找)。 */
export function normalizeLoginName(value: string): string {
  return value.includes("@") ? normalizeEmail(value) : normalizeUsername(value);
}

/** R-F1 的形状检查(只看格式,不查域名策略):ASCII、一个 @、本地部分 ≤ 64、域名含点且只含 [a-z0-9.-]、总长 ≤ 254。 */
export function isEmailShape(value: string): boolean {
  const email = normalizeEmail(value);
  if (email.length > 254) return false;
  const at = email.indexOf("@");
  if (at <= 0 || email.indexOf("@", at + 1) !== -1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !/^[!-~]+$/.test(local)) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
}

/** 返回 i18n 键;通过时返回 null。规则与服务端 sessions.py 一致。 */
export function validateCredentials(mode: "login" | "register", username: string, password: string): string | null {
  const name = normalizeUsername(username);
  if (!name || !password) return "web.login.required";
  if (mode === "register") {
    if (!USERNAME_PATTERN.test(name)) return "web.login.usernameInvalid";
    if (password.length < 8 || password.length > 128) return "web.login.passwordLength";
  }
  return null;
}
