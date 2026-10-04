export const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
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
