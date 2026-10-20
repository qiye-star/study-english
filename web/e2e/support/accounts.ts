import { execFileSync } from "node:child_process";
import { expect, type APIRequestContext } from "@playwright/test";

/**
 * 账号 v2 端到端辅助(邮箱注册 / 找回密码 / 绑定)。仅用于**隔离的测试栈**(`docker compose -p enjoy-e2e ...`)。
 *
 * 为什么能「读到」验证码:测试栈用 `EMAIL_BACKEND=console`,不会真的发信,也不记录码(服务端设计如此)。
 * 库里只存 HMAC(pepper, "<purpose>:<target_hmac>:<code>"),所以这里用测试栈的 pepper(容器环境变量里已有)对 6 位数字
 * 做离线枚举还原——只因为它是一次性测试栈、pepper 是一次性测试值。**绝不要对真实环境这样做。**
 * 约定:E2E_COMPOSE_PROJECT(默认 enjoy-e2e)决定容器名 `<project>-server-1`。
 */
const CONTAINER = `${process.env.E2E_COMPOSE_PROJECT ?? "enjoy-e2e"}-server-1`;

const PY = `
import hashlib, hmac, os, sqlite3, sys
pepper = os.environ["IDENTITY_PEPPER"].encode()
email, purpose = sys.argv[1].strip().lower(), sys.argv[2]
local, domain = email.split("@")
key = local.split("+", 1)[0] + "@" + domain
target = hmac.new(pepper, ("email:" + key).encode(), hashlib.sha256).hexdigest()
db = sqlite3.connect("file:/data/app.db?mode=ro", uri=True)
row = db.execute("select code_hmac from verification_codes where channel='email' and target_hmac=? and purpose=? "
                 "and consumed_at is null order by id desc limit 1", (target, purpose)).fetchone()
if row is None:
    print("NOROW"); sys.exit(0)
for n in range(1000000):
    c = "%06d" % n
    if hmac.compare_digest(hmac.new(pepper, ("%s:%s:%s" % (purpose, target, c)).encode(), hashlib.sha256).hexdigest(), row[0]):
        print(c); sys.exit(0)
print("NOTFOUND")
`;

/** 取该邮箱、该用途最新一条未消费验证码的明文(还原自测试库)。 */
export function codeFor(email: string, purpose: "register" | "reset" | "bind" | "change_email"): string {
  const out = execFileSync("docker", ["exec", "-i", CONTAINER, "python", "-c", PY, email, purpose], { encoding: "utf8" }).trim();
  if (!/^\d{6}$/.test(out)) throw new Error(`no code for purpose=${purpose}: ${out}`);
  return out;
}

export function newEmail(prefix = "e2e"): string {
  const s = `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
  return `${prefix}.${s}@example.com`;
}

export function newAccount() {
  const s = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  return { username: `e2e_${s}`, password: "e2e-password-123", nickname: `昵称${s}`.slice(0, 18), email: newEmail() };
}

export interface RegisteredAccount {
  username: string; password: string; nickname: string; email: string; token: string; userId: string;
}

/** 走真实接口注册一个带邮箱的账号:发码 -> 还原码 -> 注册。 */
export async function registerWithEmailViaApi(request: APIRequestContext, inviteCode: string, over: Partial<ReturnType<typeof newAccount>> = {}): Promise<RegisteredAccount> {
  const a = { ...newAccount(), ...over };
  const sent = await request.post("/api/email/code", { data: { email: a.email, purpose: "register" } });
  expect(sent.status(), await sent.text()).toBe(200);
  const code = codeFor(a.email, "register");
  const r = await request.post("/api/users", {
    data: { username: a.username, password: a.password, nickname: a.nickname, email: a.email, email_code: code, invite_code: inviteCode },
  });
  expect(r.status(), await r.text()).toBe(200);
  const body = await r.json();
  return { ...a, token: body.access_token as string, userId: String(body.id) };
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
