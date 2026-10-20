import { devices, expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { bearer, codeFor, fillRegisterStep2, newAccount, newEmail, registerInUi, registerWithEmailViaApi, type RegisteredAccount } from "./support/accounts";
import { INVITE_CODE, loginViaUi } from "./support/auth";
import { mockUpstreams, type UpstreamMocks } from "./support/mock-upstreams";

/**
 * 账号 v2 的端到端:邮箱注册、登录(用户名或邮箱)、找回密码、防枚举、「我的」里的昵称 / 改密 / 头像、邀请码。
 * 只打自家后端(邮件走测试栈的 console 后端,验证码由 support/accounts.ts 从测试库还原)。
 * 每个用例自己造用户;用例串行。页面没有 data-testid 的地方用标签 / 角色定位。
 */
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8100";
const NEW_PASSWORD = "e2e-new-password-456";
/** 1×1 透明 PNG(合法图片,测试里现场解码,仓库里没有图片文件)。 */
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** 每个用例开的页面都挂上防漏守卫;用例结束时断言没有任何未放行的 /api 请求。 */
const guards: UpstreamMocks[] = [];
async function guard(page: Page): Promise<Page> {
  guards.push(await mockUpstreams(page));
  return page;
}

test.describe.configure({ mode: "serial" });

test.afterEach(() => {
  for (const m of guards.splice(0)) expect(m.unmocked, "requests that reached the upstream guard").toEqual([]);
});

/** 首页的个人卡进入账号设置(/me/account)。 */
async function openAccountSettings(page: Page): Promise<void> {
  await page.getByTestId("nav-me").click();
  await page.getByTestId("me-profile").click();
}

/** 账号设置页的账号区(SectionGroup,标题「账号」/ Account)。 */
function accountGroup(page: Page) {
  return page.getByRole("group", { name: "Account", exact: true });
}

/** 账号设置页底部的退出(对应 account-logout),回到登录页。 */
async function logout(page: Page): Promise<void> {
  await openAccountSettings(page);
  await page.getByTestId("account-logout").click();
  await expect(page).toHaveURL(/\/login$/);
}

/** 直接用密码换一个新令牌(另一台设备),用来检查改密 / 找回之后它是否被登出。 */
async function sessionToken(request: APIRequestContext, username: string, password: string): Promise<string> {
  const r = await request.post("/api/sessions", { data: { provider: "password", username, password } });
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()).access_token as string;
}

function maskedEmail(email: string): string {
  return `${email[0]}***@${email.split("@")[1]}`;
}

/**
 * 从邀请链接注册:直接打开 `…/register#invite=CODE`,片段带入的邀请码必须已经填好。
 * 不经过 registerInUi(它会先 goto("/register") 把片段丢掉)。
 */
async function registerFromLink(page: Page, link: string, account: ReturnType<typeof newAccount>): Promise<void> {
  await page.goto(link);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await expect(page.getByTestId("register-code-note")).toBeVisible();
  await fillRegisterStep2(page, { ...account, code: codeFor(account.email, "register") });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
}

test.describe("accounts", () => {
  test("a. registers in the UI: a wrong code keeps the form, the right code signs in", async ({ page }) => {
    await guard(page);
    const a = newAccount();
    await page.goto("/register");
    await page.getByLabel("Email", { exact: true }).fill(a.email);
    await page.getByRole("button", { name: "Send code", exact: true }).click();
    await expect(page.getByTestId("register-code-note")).toBeVisible();
    const real = codeFor(a.email, "register");
    const wrong = real === "000000" ? "111111" : "000000";

    await fillRegisterStep2(page, { ...a, code: wrong, invite: INVITE_CODE });
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByTestId("register-error")).toHaveText("The code is invalid or has expired.");
    await expect(page).toHaveURL(/\/register$/);
    // 失败后表单保留用户已填的内容
    await expect(page.getByLabel("Username", { exact: true })).toHaveValue(a.username);
    await expect(page.getByLabel("Nickname", { exact: true })).toHaveValue(a.nickname);
    await expect(page.getByLabel("Invite code (optional)", { exact: true })).toHaveValue(INVITE_CODE);

    await page.getByLabel("Verification code", { exact: true }).fill(real);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page).toHaveURL(/\/practice$/);

    await openAccountSettings(page);
    await expect(page.getByLabel("Nickname", { exact: true })).toHaveValue(a.nickname);
    const email = page.getByTestId("account-email-open");
    await expect(email).toContainText("Verified");
    await expect(email).toContainText(maskedEmail(a.email));
    await expect(email).not.toContainText(a.email);
  });

  test("b. logs back in by username and by email; a wrong password gives the same message", async ({ page, request }) => {
    await guard(page);
    const a = await registerWithEmailViaApi(request, INVITE_CODE);
    await loginViaUi(page, a.username, a.password);
    await expect(page).toHaveURL(/\/practice$/);
    await logout(page);

    await loginViaUi(page, a.email, a.password);
    await expect(page).toHaveURL(/\/practice$/);
    await logout(page);

    // 已知用户名 + 错密码,与未知用户名 + 任意密码:同一句提示
    await loginViaUi(page, a.username, "definitely-wrong");
    await expect(page.getByTestId("login-error")).toHaveText("Invalid username or password.");
    await expect(page).toHaveURL(/\/login$/);
    await loginViaUi(page, `nobody_${Date.now().toString(36)}`, "definitely-wrong");
    await expect(page.getByTestId("login-error")).toHaveText("Invalid username or password.");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("c. resets the password from the forgot-password page; sessions from before the reset stop working", async ({ page, request }) => {
    await guard(page);
    const a = await registerWithEmailViaApi(request, INVITE_CODE);
    const beforeReset = await sessionToken(request, a.username, a.password);

    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?", exact: true }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByLabel("Email", { exact: true }).fill(a.email);
    await page.getByRole("button", { name: "Send code", exact: true }).click();
    await expect(page.getByTestId("forgot-note")).toBeVisible();
    const code = codeFor(a.email, "reset");
    await page.getByLabel("Verification code", { exact: true }).fill(code);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Reset password", exact: true }).click();

    // 成功后不自动登录:回到登录页并带「请用新密码登录」的提示
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("login-notice")).toBeVisible();

    await loginViaUi(page, a.username, a.password);
    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await loginViaUi(page, a.username, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/practice$/);

    // 重置之前签发的令牌(含注册时拿到的)都被拒绝
    expect((await request.get("/api/me", { headers: bearer(beforeReset) })).status()).toBe(401);
    expect((await request.get("/api/me", { headers: bearer(a.token) })).status()).toBe(401);
  });

  test("d. the register code endpoint answers the same for known and unknown addresses", async ({ request }) => {
    const known = await registerWithEmailViaApi(request, INVITE_CODE);
    // 注册时已经为这个地址发过一次 register 码;同一地址、同一用途有 60 秒冷却(429),所以先等冷却结束
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    const knownResp = await request.post("/api/email/code", { data: { email: known.email, purpose: "register" } });
    const freshResp = await request.post("/api/email/code", { data: { email: newEmail(), purpose: "register" } });
    expect(knownResp.status()).toBe(200);
    expect(freshResp.status()).toBe(200);
    const knownBody = await knownResp.json();
    const freshBody = await freshResp.json();
    expect(Object.keys(knownBody).sort()).toEqual(Object.keys(freshBody).sort());
    expect(knownBody).toEqual(freshBody);

    // 已注册的邮箱不能再注册第二个账号(即使随便填一个码,也只得到同样的 400)
    const dup = await request.post("/api/users", {
      data: { username: newAccount().username, password: "e2e-password-123", nickname: "dup", email: known.email,
        email_code: "000000", invite_code: INVITE_CODE },
    });
    expect(dup.status()).toBe(400);
    expect(await dup.json()).toEqual({ error: "Invalid or expired code" });
  });

  test("e. me page: nickname rule, nickname save, password change signs other sessions out", async ({ page, request }) => {
    await guard(page);
    const a = await registerWithEmailViaApi(request, INVITE_CODE);
    const other = await registerWithEmailViaApi(request, INVITE_CODE);
    await loginViaUi(page, a.username, a.password);
    await expect(page).toHaveURL(/\/practice$/);
    await openAccountSettings(page);

    // 「保存」按钮限定在昵称行里(账号页上可能还有其他「保存」)
    const nickname = page.getByLabel("Nickname", { exact: true });
    await expect(nickname).toHaveValue(a.nickname);
    const save = nickname.locator("xpath=..").getByRole("button", { name: "Save", exact: true });
    const status = page.getByTestId("account-nickname-status");

    // 昵称不能是别人的登录名(大小写不敏感);错误文案固定,不说明规则
    await nickname.fill(other.username);
    await save.click();
    await expect(status).toHaveText("This nickname can't be used");
    await nickname.fill(other.username.toUpperCase());
    await save.click();
    await expect(status).toHaveText("This nickname can't be used");
    // 管理员登录名同样不能用
    await nickname.fill("admin");
    await save.click();
    await expect(status).toHaveText("This nickname can't be used");

    // 合法昵称:保存成功,显示名随之更新(头像的可访问名称)
    const suffix = Date.now().toString(36);
    const fresh = `Zed${suffix}`;
    await nickname.fill(fresh);
    await save.click();
    await expect(status).toHaveText("Nickname saved");
    // 显示名:账号区头像的可访问名称(「我的」页上方的英雄区头像也会一起更新,这里只看账号区)
    await expect(accountGroup(page).getByRole("img", { name: fresh, exact: true })).toBeVisible();
    await page.reload();
    await openAccountSettings(page);
    await expect(page.getByLabel("Nickname", { exact: true })).toHaveValue(fresh);

    // 改密:另一台设备(提前签发的令牌)被登出,本机仍保持登录
    const otherDevice = await sessionToken(request, a.username, a.password);
    await page.getByTestId("account-password-open").click();
    await page.getByLabel("Current password", { exact: true }).fill(a.password);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Update password", exact: true }).click();
    await expect(page.getByTestId("account-password-status")).toHaveText("Password changed. Other devices are signed out.");
    expect((await request.get("/api/me", { headers: bearer(otherDevice) })).status()).toBe(401);
    await page.reload();
    await openAccountSettings(page);
    await expect(page.getByLabel("Nickname", { exact: true })).toHaveValue(fresh);
    // 新旧密码以 API 复核
    expect((await request.post("/api/sessions", { data: { provider: "password", username: a.username, password: NEW_PASSWORD } })).status()).toBe(200);
    expect((await request.post("/api/sessions", { data: { provider: "password", username: a.username, password: a.password } })).status()).toBe(401);
  });

  test("f. avatar: upload a PNG, reject oversize and invalid files, remove it", async ({ page, request }) => {
    await guard(page);
    const a = await registerWithEmailViaApi(request, INVITE_CODE);
    await loginViaUi(page, a.username, a.password);
    await expect(page).toHaveURL(/\/practice$/);
    await openAccountSettings(page);

    const picker = page.getByTestId("avatar-file");
    const status = page.getByTestId("account-avatar-status");
    await picker.setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(status).toHaveText("Avatar updated");
    await expect(page.locator('img[src*="/api/avatars/"]').first()).toBeVisible();

    // 超过 2 MB:服务端 413
    await picker.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(3 * 1024 * 1024, 0x41) });
    await expect(status).toHaveText("The image is too large. Choose a smaller one.");
    // 不是图片的内容:服务端 422
    await picker.setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: Buffer.from("this is not a picture") });
    await expect(status).toHaveText("This image can't be used. Choose a JPEG, PNG or WebP.");

    // 移除:二次确认后回到首字母
    await page.getByRole("button", { name: "Remove avatar", exact: true }).click();
    await page.getByRole("button", { name: "Confirm removal", exact: true }).click();
    await expect(status).toHaveText("Avatar removed");
    await expect(page.locator('img[src*="/api/avatars/"]')).toHaveCount(0);
    await expect(accountGroup(page).getByRole("img", { name: displayOf(a), exact: true })).toBeVisible();
  });

  test("g. invite codes: create, share by fragment link, register invitees, replace the code", async ({ page, request, browser }) => {
    await guard(page);
    const owner = await registerWithEmailViaApi(request, INVITE_CODE);
    await loginViaUi(page, owner.username, owner.password);
    await expect(page).toHaveURL(/\/practice$/);
    await openAccountSettings(page);

    await page.getByRole("button", { name: "Create my invite code", exact: true }).click();
    const code = page.getByTestId("my-invite-code");
    await expect(code).toHaveText(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const firstCode = (await code.innerText()).trim();
    await expect(page.getByTestId("my-invite-usage")).toHaveText("Used 0 of 10");

    // 分享:「复制链接」写入剪贴板的就是 `…/register#invite=CODE`
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(page.getByTestId("my-invite-note")).toHaveText("Copied");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(`${BASE}/register#invite=${firstCode}`);

    // 被邀请人在全新的上下文里打开链接:邀请码已带入,地址栏的片段被清掉
    const inviteeA = newAccount();
    const ctxA: BrowserContext = await browser.newContext({ ...devices["Pixel 7"] });
    try {
      const pageA = await guard(await ctxA.newPage());
      await registerFromLink(pageA, link, inviteeA);
      await expect(pageA).toHaveURL(/\/practice$/);
      expect(pageA.url()).not.toContain("#invite");
    } finally {
      await ctxA.close();
    }

    // 主人刷新后:已用 1 次,被邀请人显示名可见
    await page.reload();
    await openAccountSettings(page);
    await expect(page.getByTestId("my-invite-usage")).toHaveText("Used 1 of 10");
    await expect(page.getByTestId("my-invite-invitees")).toContainText(inviteeA.nickname);

    // 更换:确认框说明旧码立即失效、已用次数延续;旧码注册失败,新码可用,次数不清零
    await page.getByRole("button", { name: "Replace invite code", exact: true }).click();
    await expect(page.getByTestId("my-invite-confirm")).toBeVisible();
    await page.getByRole("button", { name: "Replace code", exact: true }).click();
    await expect(page.getByTestId("my-invite-note")).toHaveText("Replaced. The old code no longer works.");
    const secondCode = (await code.innerText()).trim();
    expect(secondCode).not.toBe(firstCode);
    await expect(page.getByTestId("my-invite-usage")).toHaveText("Used 1 of 10");

    const ctxOld: BrowserContext = await browser.newContext({ ...devices["Pixel 7"] });
    try {
      const pageOld = await guard(await ctxOld.newPage());
      await registerFromLink(pageOld, `${BASE}/register#invite=${firstCode}`, newAccount());
      await expect(pageOld.getByTestId("register-error")).toHaveText("Invalid invite code.");
      await expect(pageOld).toHaveURL(/\/register$/);
    } finally {
      await ctxOld.close();
    }

    const ctxNew: BrowserContext = await browser.newContext({ ...devices["Pixel 7"] });
    try {
      const pageNew = await guard(await ctxNew.newPage());
      await registerFromLink(pageNew, `${BASE}/register#invite=${secondCode}`, newAccount());
      await expect(pageNew).toHaveURL(/\/practice$/);
    } finally {
      await ctxNew.close();
    }

    await page.reload();
    await openAccountSettings(page);
    await expect(page.getByTestId("my-invite-usage")).toHaveText("Used 2 of 10");
    await expect(page.getByTestId("my-invite-code")).toHaveText(secondCode);
  });
});

/** 个人资料里显示的名字:没有昵称时即登录名。 */
function displayOf(a: RegisteredAccount): string {
  return a.nickname || a.username;
}
