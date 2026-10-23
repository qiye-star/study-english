import { expect, test, type APIRequestContext, type Page, type Request as PwRequest } from "@playwright/test";
import { codeFor, fillRegisterStep2, newAccount, newEmail } from "./support/accounts";
import { adminSession, captchaHeader, payloadKeys, setCaptchaMode, type CaptchaMode } from "./support/captcha";
import { HOME_URL, INVITE_CODE, loginViaUi } from "./support/auth";
import { mockUpstreams, type UpstreamMocks } from "./support/mock-upstreams";

/**
 * 人机验证(ALTCHA)端到端。只打隔离测试栈的自家后端(零上游费用)。
 * 只在一次性测试栈运行:栈的难度被压到最低(CAPTCHA_COST=1),解题用容器里的官方库(support/captcha.ts)。
 * 模式由管理端热改(captcha_mode 是危险设置:step-up + 理由 + 输入确认词);所有阶段结束后恢复为 off。
 * 载荷只在内存里:断言它不出现在页面文本、存储、cookie 与请求的 URL / 请求体里。
 */
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8100";
const ORIGIN = new URL(BASE).origin;
const NEW_PASSWORD = "e2e-new-password-456";

test.describe.configure({ mode: "serial" });

/** 每个用例的守卫:未放行的 /api 请求(可能触达上游)必须为空。 */
const guards: UpstreamMocks[] = [];
async function guard(page: Page): Promise<Page> {
  guards.push(await mockUpstreams(page));
  return page;
}
test.afterEach(() => {
  for (const m of guards.splice(0)) expect(m.unmocked, "requests that reached the upstream guard").toEqual([]);
});

let admin: Awaited<ReturnType<typeof adminSession>> | undefined;

test.beforeAll(async () => {
  admin = await adminSession();
});

test.afterAll(async () => {
  try {
    if (admin) await setCaptchaMode(admin, "off");
  } finally {
    await admin?.ctx.dispose();
  }
});

async function mode(m: CaptchaMode): Promise<void> {
  if (!admin) throw new Error("admin session missing");
  await setCaptchaMode(admin, m);
}

const widget = (page: Page) => page.getByRole("group", { name: "Human verification", exact: true });

/** 勾选组件复选框,等它进入已验证状态(发码/提交按钮只在验证后可用)。 */
async function solveWidget(page: Page): Promise<void> {
  // 原生复选框被组件的可见方框遮住(它不可点),所以点击可见的标签文字;状态以原生复选框的 checked 为准。
  // 发码或失败之后组件会自己重新求解(标签暂时消失),此时只等待勾选,不点击。
  const box = widget(page).getByRole("checkbox");
  const label = widget(page).getByText(/I'm not a robot|我不是机器人/);
  if (!(await box.isChecked()) && (await label.isVisible())) await label.click();
  await expect(box).toBeChecked();
}

/** 一次带载荷的 API 注册(邮箱注册需要 register 与 email_code 两个作用域的验证)。 */
async function apiRegister(request: APIRequestContext) {
  const a = newAccount();
  const sent = await request.post("/api/email/code", { data: { email: a.email, purpose: "register" }, headers: await captchaHeader(request) });
  expect(sent.status(), "send code with a solved challenge").toBe(200);
  const r = await request.post("/api/users", {
    data: { username: a.username, password: a.password, nickname: a.nickname, email: a.email, email_code: codeFor(a.email, "register"), invite_code: INVITE_CODE },
    headers: await captchaHeader(request),
  });
  expect(r.status(), "create account with a solved challenge").toBe(200);
  return { ...a, userId: String((await r.json()).id) };
}

/** 页面请求的记录(只在测试内存里比对,从不打印)。 */
interface Seen { method: string; url: string; headers: Record<string, string>; post: string }
function recordRequests(page: Page): Seen[] {
  const seen: Seen[] = [];
  page.on("request", (req: PwRequest) => {
    seen.push({ method: req.method(), url: req.url(), headers: req.headers(), post: req.postData() ?? "" });
  });
  return seen;
}

/** 可见文本、存储与 cookie 里都不得出现载荷(完整值)。 */
async function assertPayloadHidden(page: Page, payload: string): Promise<void> {
  const text = await page.locator("body").innerText();
  expect(text.includes(payload), "payload in visible text").toBe(false);
  const stores = await page.evaluate(() => {
    const dump = (s: Storage) => {
      try {
        return JSON.stringify(Object.fromEntries(Array.from({ length: s.length }, (_, i) => [s.key(i), s.getItem(s.key(i) ?? "")])));
      } catch {
        return "";
      }
    };
    return dump(window.localStorage) + dump(window.sessionStorage);
  });
  expect(stores.includes(payload), "payload in web storage").toBe(false);
  const cookies = JSON.stringify(await page.context().cookies());
  expect(cookies.includes(payload), "payload in cookies").toBe(false);
}

test.describe("captcha", () => {
  test("a. API in adaptive: missing, garbage, replayed and forged payloads", async ({ request }) => {
    await mode("adaptive");
    const email = newEmail("cap");

    // 无头 -> 428 captcha_required(不发码)
    let r = await request.post("/api/email/code", { data: { email, purpose: "register" } });
    expect(r.status()).toBe(428);
    expect(await r.text()).toContain("captcha_required");

    // 垃圾头 -> 428 captcha_invalid
    r = await request.post("/api/email/code", { data: { email, purpose: "register" }, headers: { "X-Captcha": "not-a-payload" } });
    expect(r.status()).toBe(428);
    expect(await r.text()).toContain("captcha_invalid");

    // 合法载荷 -> 200;同一个再用一次 -> 428 captcha_invalid(重放)
    const good = await captchaHeader(request);
    r = await request.post("/api/email/code", { data: { email, purpose: "register" }, headers: good });
    expect(r.status(), await r.text()).toBe(200);
    r = await request.post("/api/email/code", { data: { email, purpose: "register" }, headers: good });
    expect(r.status()).toBe(428);
    expect(await r.text()).toContain("captcha_invalid");

    // 伪造:解码 JSON 里改掉 challenge.signature 的一个字符 -> 428 captcha_invalid
    const fresh = await captchaHeader(request);
    const obj = JSON.parse(Buffer.from(fresh["X-Captcha"], "base64").toString("utf8"));
    const sig: string = obj.challenge.signature;
    obj.challenge.signature = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    const forged = Buffer.from(JSON.stringify(obj)).toString("base64");
    r = await request.post("/api/email/code", { data: { email, purpose: "register" }, headers: { "X-Captcha": forged } });
    expect(r.status()).toBe(428);
    expect(await r.text()).toContain("captcha_invalid");

    // 注册接口同样需要:字段检查(邮箱、昵称、验证码)先于人机验证,所以请求体要完整,才会走到 428
    const full = newAccount();
    r = await request.post("/api/users", {
      data: { username: full.username, password: full.password, nickname: full.nickname, email: full.email, email_code: "000000", invite_code: INVITE_CODE },
    });
    expect(r.status()).toBe(428);
    expect(await r.text()).toContain("captcha_required");
    // 其他接口不受影响(未登录的 /api/me 不是 428)
    const me = await request.get("/api/me");
    expect(me.status()).not.toBe(428);
  });

  test("b. real widget in adaptive: register in the UI, same-origin requests, payload never stored", async ({ page }) => {
    await mode("adaptive");
    await guard(page);
    const seen = recordRequests(page);
    const a = newAccount();
    await page.goto("/register");
    await expect(widget(page)).toBeVisible();
    await solveWidget(page);
    await page.getByLabel("Email", { exact: true }).fill(a.email);
    await page.getByRole("button", { name: "Send code", exact: true }).click();
    await expect(page.getByTestId("register-code-note")).toBeVisible();
    const real = codeFor(a.email, "register");
    const wrong = real === "000000" ? "111111" : "000000";

    // 第一次提交用错误的验证码:失败后组件应重置并重新求解,下一次要用新载荷
    await solveWidget(page);
    await fillRegisterStep2(page, { ...a, code: wrong, invite: INVITE_CODE });
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByTestId("register-error")).toBeVisible();

    await solveWidget(page);
    await page.getByLabel("Verification code", { exact: true }).fill(real);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page).toHaveURL(HOME_URL);

    // 所有请求都在本站;挑战请求没有查询串;带头的请求 URL 与请求体里没有载荷
    expect(seen.filter((s) => new URL(s.url).origin !== ORIGIN).map((s) => s.url), "third-party requests").toEqual([]);
    const challenges = seen.filter((s) => new URL(s.url).pathname === "/api/captcha/challenge");
    expect(challenges.length).toBeGreaterThan(0);
    expect(challenges.every((s) => new URL(s.url).search === "")).toBe(true);
    const sent = seen.filter((s) => s.method === "POST" && new URL(s.url).pathname === "/api/email/code");
    expect(sent.length).toBe(1);
    const users = seen.filter((s) => s.method === "POST" && new URL(s.url).pathname === "/api/users");
    expect(users.length, "a failed attempt then a retry").toBe(2);
    const h0 = users[0].headers["x-captcha"] ?? "";
    const h1 = users[1].headers["x-captcha"] ?? "";
    expect(h0.length, "first attempt carries a payload").toBeGreaterThan(0);
    expect(h1.length, "retry carries a payload").toBeGreaterThan(0);
    expect(h1, "retry uses a fresh payload").not.toBe(h0);
    for (const s of [...sent, ...users]) {
      const header = s.headers["x-captcha"] ?? "";
      expect(header.length > 0 && s.url.includes(header), "payload in URL").toBe(false);
      expect(header.length > 0 && s.post.includes(header), "payload in request body").toBe(false);
    }
    // 解码后的键名形状(只比对键名,不打印值)
    const shape = payloadKeys(sent[0].headers["x-captcha"]);
    expect(shape.top).toEqual(["challenge", "solution"]);
    expect(shape.challenge).toEqual(expect.arrayContaining(["parameters", "signature"]));

    await assertPayloadHidden(page, sent[0].headers["x-captcha"]);
  });

  test("c. login in adaptive: five failures flag the name (known and unknown) with identical 428s", async ({ page, request }) => {
    await mode("adaptive");
    const user = await apiRegister(request);
    const ghost = `e2e_ghost_${Date.now().toString(36)}`;

    // 五次错误密码(每次 401),第六次正确密码但没带载荷 -> 428 captcha_required
    for (let i = 0; i < 5; i++) {
      const r = await request.post("/api/sessions", { data: { provider: "password", username: user.username, password: `wrong-${i}-xx` } });
      expect(r.status()).toBe(401);
    }
    let r = await request.post("/api/sessions", { data: { provider: "password", username: user.username, password: user.password } });
    expect(r.status()).toBe(428);
    expect(await r.text()).toContain("captcha_required");

    // 未知用户名:标记按「同一 IP」计数(R-C9),本 IP 已被标记,所以未知名的第一次尝试也是同样的 428。
    // 这证明未知名与已知名得到完全相同的响应;单一 IP 无法单独证明「只按名字计数」(见报告的未验证项)。
    const r2 = await request.post("/api/sessions", { data: { provider: "password", username: ghost, password: "wrong-x-xx" } });
    expect(r2.status()).toBe(428);
    expect(await r2.text()).toContain("captcha_required");
  });

  test("c-ui. login page in adaptive: the first submit shows the widget and the solved login succeeds", async ({ page, request }) => {
    await mode("adaptive");
    const user = await apiRegister(request);
    await guard(page);
    await page.goto("/login");
    await page.getByTestId("login-username").fill(user.username);
    await page.getByTestId("login-password").fill(user.password);
    await page.getByTestId("login-submit").click();
    await expect(widget(page)).toBeVisible();
    await solveWidget(page);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(HOME_URL);
  });

  test("d. forgot-password in adaptive: both steps pass through the widget", async ({ page, request }) => {
    await mode("adaptive");
    const user = await apiRegister(request);
    await guard(page);
    await page.goto("/forgot-password");
    await expect(widget(page)).toBeVisible();
    await solveWidget(page);
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByRole("button", { name: "Send code", exact: true }).click();
    await expect(page.getByTestId("forgot-note")).toBeVisible();
    await solveWidget(page);
    await page.locator("#forgot-code").fill(codeFor(user.email, "reset"));
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("login-notice")).toBeVisible();
    // 本 IP 已被测试 c 标记,登录会先得到 428,页面显示组件;解出后再提交
    await loginViaUi(page, user.username, NEW_PASSWORD);
    await expect(widget(page)).toBeVisible();
    await solveWidget(page);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(HOME_URL);
  });

  test("c2. always: the widget shows at once and login is blocked until solved", async ({ page, request }) => {
    await mode("adaptive");
    const user = await apiRegister(request);
    await mode("always");
    await guard(page);
    await page.goto("/login");
    await expect(widget(page)).toBeVisible();
    await page.getByTestId("login-username").fill(user.username);
    await page.getByTestId("login-password").fill(user.password);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await solveWidget(page);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(HOME_URL);
  });

  // 服务工作线程会从缓存提供静态资源,page.route 拦不住;这里屏蔽它,让分块请求真正走网络。
  test.use({ serviceWorkers: "block" });
  test("f. always: a failed captcha chunk does not blank the login page", async ({ page }) => {
    await mode("always");
    await guard(page);
    await page.route("**/captcha-*.js", (route) => route.abort("failed"));
    await page.goto("/login");
    await expect(page.getByTestId("login-username")).toBeVisible();
    await expect(page.getByText("Could not load", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  });

  test("e. off: no widget on register or login, and no challenge request", async ({ page }) => {
    await mode("off");
    await guard(page);
    const seen = recordRequests(page);
    await page.goto("/register");
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(widget(page)).toHaveCount(0);
    await page.goto("/login");
    await expect(page.getByTestId("login-username")).toBeVisible();
    await expect(widget(page)).toHaveCount(0);
    // 页面只读一次模式(GET /api/captcha/config);挑战端点与任何验证请求都不应出现
    const captchaCalls = seen.map((s) => new URL(s.url).pathname).filter((p) => p.startsWith("/api/captcha/"));
    expect(captchaCalls.filter((p) => p !== "/api/captcha/config")).toEqual([]);
  });
});
