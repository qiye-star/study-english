import { execFileSync } from "node:child_process";
import { request as playwrightRequest, expect, type APIRequestContext } from "@playwright/test";

/**
 * 人机验证(ALTCHA)端到端辅助。仅用于**一次性的隔离测试栈**(`docker compose -p enjoy-e2e ...`):
 * 栈的覆盖文件把难度压到最低(CAPTCHA_COST=1、CAPTCHA_COUNTER_MAX=10),并放宽挑战速率限制,
 * 所以这里用容器里的官方 `altcha` 库现场解题。**绝不要对真实环境使用这些辅助。**
 * 载荷只作为返回值交给调用方放进 X-Captcha 请求头;不打印、不写文件、不进断言消息。
 * 约定:E2E_COMPOSE_PROJECT(默认 enjoy-e2e)决定容器名 `<project>-server-1`。
 */
const CONTAINER = `${process.env.E2E_COMPOSE_PROJECT ?? "enjoy-e2e"}-server-1`;
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8100";

// 与 server/tests/captcha_helpers.py 的 header_for 同一逻辑:官方库解题,拼成 {"challenge", "solution"} 的 base64 JSON。
const PY = `
import base64, json, sys
import altcha
challenge = json.loads(sys.stdin.read())
solved = altcha.solve_challenge(altcha.Challenge.from_dict(challenge), counter_start=0)
if solved is None:
    sys.exit(2)
payload = {"challenge": challenge, "solution": solved.to_dict()}
sys.stdout.write(base64.b64encode(json.dumps(payload).encode()).decode())
`;

/** 取一个新挑战(走 Playwright 的请求上下文),在容器里解出,返回 `{ "X-Captcha": payload }`。 */
export async function captchaHeader(request: APIRequestContext): Promise<Record<string, string>> {
  const r = await request.get("/api/captcha/challenge");
  expect(r.status(), "challenge endpoint").toBe(200);
  const challenge = await r.json();
  const out = execFileSync("docker", ["exec", "-i", CONTAINER, "/app/.venv/bin/python", "-c", PY], {
    input: JSON.stringify(challenge),
    encoding: "utf8",
  }).trim();
  if (!/^[A-Za-z0-9+/]+=*$/.test(out)) throw new Error("solver returned no payload");
  return { "X-Captcha": out };
}

/** 解出的载荷的结构(只看键名,不看值):用于断言形状,绝不打印值。 */
export function payloadKeys(header: string): { top: string[]; challenge: string[]; solution: string[] } {
  const obj = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Record<string, Record<string, unknown>>;
  return { top: Object.keys(obj).sort(), challenge: Object.keys(obj.challenge ?? {}).sort(), solution: Object.keys(obj.solution ?? {}).sort() };
}

export type CaptchaMode = "off" | "adaptive" | "always";

/**
 * 管理端登录(账号与密码来自测试栈环境变量;不打印)。返回一个带会话 cookie 的请求上下文与 CSRF 令牌。
 * 调用方用完要 dispose()。
 */
export async function adminSession(): Promise<{ ctx: APIRequestContext; csrf: string }> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE });
  const r = await ctx.post("/api/admin/login", {
    data: { username: process.env.E2E_ADMIN_USERNAME ?? "root", password: process.env.E2E_ADMIN_PASSWORD ?? "" },
  });
  expect(r.status(), "admin login").toBe(200);
  const body = (await r.json()) as { csrf_token: string };
  return { ctx, csrf: body.csrf_token };
}

/**
 * 热改 captcha_mode(危险设置:每次改动都要二次验证 + 理由 + 输入确认词 CAPTCHA_MODE)。
 * 与 accounts-admin.spec.ts 的流程一致:先 step-up(重新输入管理员密码),再 PATCH /api/admin/settings。
 * 已经是目标值就什么也不做。调用方必须在 finally 里把它恢复为 off。
 */
export async function setCaptchaMode(admin: { ctx: APIRequestContext; csrf: string }, mode: CaptchaMode): Promise<void> {
  // 偶发的 keep-alive 断连(socket hang up)只重试读取,不重试写入。
  let current;
  for (let attempt = 1; ; attempt++) {
    try {
      current = await admin.ctx.get("/api/captcha/config");
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
    }
  }
  expect(current.status()).toBe(200);
  if (((await current.json()) as { mode: string }).mode === mode) return;
  const headers = { "X-Admin-CSRF": admin.csrf };
  const up = await admin.ctx.post("/api/admin/step-up", { headers, data: { password: process.env.E2E_ADMIN_PASSWORD ?? "" } });
  expect(up.status(), "admin step-up").toBe(200);
  const patch = await admin.ctx.patch("/api/admin/settings", {
    headers,
    data: { changes: { captcha_mode: mode }, reason: "e2e captcha spec", confirm: "CAPTCHA_MODE" },
  });
  expect(patch.status(), await patch.text()).toBe(200);
  const after = await admin.ctx.get("/api/captcha/config");
  expect(((await after.json()) as { mode: string }).mode).toBe(mode);
}
