import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { HOME_URL, loginViaUi } from "./support/auth";
import { bearer, codeFor, newAccount, newEmail, registerWithEmailViaApi } from "./support/accounts";
import { mockUpstreams } from "./support/mock-upstreams";

/**
 * 账号功能的管理端端到端(邀请码、用户邀请卡、邮箱、强制绑定、头像举报、诊断)。
 * 只打隔离测试栈的自家后端(零上游费用)。管理端在 1440 px 桌面上下文里操作,网页端用项目默认的手机设备。
 * 测试栈里的值(邀请码、邮箱、密码、pepper)只留在内存里:不打印、不写入断言消息、不进 URL。
 * 用例按顺序执行:每段自己创建账号,并在 finally 里把热开关恢复。
 */
const ADMIN = { username: process.env.E2E_ADMIN_USERNAME ?? "root", password: process.env.E2E_ADMIN_PASSWORD ?? "" };
const INVITE = process.env.E2E_INVITE_CODE ?? "";
const PEPPER = process.env.E2E_IDENTITY_PEPPER ?? "";

test.describe.configure({ mode: "serial" });
test.skip(!ADMIN.password, "E2E_ADMIN_PASSWORD not set");
test.skip(!INVITE, "E2E_INVITE_CODE not set");

/**
 * 练习页/页脚会读 /api/library/config 与 /api/changelog(只读数据库)。守卫(upstream-guard.ts)尚未把它们分类,
 * 这里只把这两条从「不应出现」里排除;其余未模拟的路径一律算作意外。见报告中的守卫缺口。
 */
const READ_ONLY_OWN = /^GET \/api\/(library\/config|changelog)$/;
const unexpected = (paths: string[]) => paths.filter((p) => !READ_ONLY_OWN.test(p));

/** 本次运行里出现过的明文值。页面 HTML 里不得出现;只用布尔结果断言,不把值写进消息。 */
const secrets = new Set<string>([ADMIN.password, INVITE, PEPPER].filter(Boolean));
const remember = (...values: string[]) => values.forEach((v) => v && secrets.add(v));
async function assertNoLeak(page: Page): Promise<void> {
  const html = await page.content();
  const leaked = [...secrets].some((s) => html.includes(s));
  expect(leaked, "a plain code, email, key or password appears on the page").toBe(false);
}

async function adminPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    locale: "zh-CN", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto("/admin/login");
  await page.getByLabel("账号").fill(ADMIN.username);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("link", { name: "概览" }).first()).toBeVisible();
  return { context, page };
}

/** 危险操作第一次提交会被要求二次验证(403 Step-up required),验证后客户端自动重放原请求。 */
async function stepUpIfAsked(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "需要二次验证" });
  try {
    await dialog.waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    return;
  }
  await dialog.getByLabel("密码").fill(ADMIN.password);
  await dialog.getByRole("button", { name: "验证并继续" }).click();
  await expect(dialog).toBeHidden();
}

/** 走邮箱注册的原始接口;返回状态码与响应体,用于断言被拒绝的情形。 */
async function registerRaw(request: APIRequestContext, inviteCode: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const a = newAccount();
  remember(a.email);
  const sent = await request.post("/api/email/code", { data: { email: a.email, purpose: "register" } });
  expect(sent.status()).toBe(200);
  const code = codeFor(a.email, "register");
  const r = await request.post("/api/users", {
    data: { username: a.username, password: a.password, nickname: a.nickname, email: a.email, email_code: code, invite_code: inviteCode },
  });
  return { status: r.status(), body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

/** 邮箱注册关闭时的无邮箱注册(只用于制造未绑定账号);返回用户名、密码、id 与 token。 */
async function registerUnbound(request: APIRequestContext, inviteCode: string) {
  const a = newAccount();
  remember(a.password);
  const r = await request.post("/api/users", { data: { username: a.username, password: a.password, invite_code: inviteCode } });
  expect(r.status(), "unbound registration with email registration off").toBe(200);
  const body = await r.json();
  return { username: a.username, password: a.password, userId: String(body.id), token: body.access_token as string };
}

/**
 * 在管理端「账号」设置页改开关/字段并保存(走检查、理由、二次验证)。
 * edits 只做草稿修改;没有草稿(没有「检查并保存」按钮)时什么也不做。
 */
async function editAccountSettings(page: Page, reason: string, edits: () => Promise<void>): Promise<void> {
  await page.goto("/admin/settings/accounts");
  await expect(page.getByTestId("setting-email_binding_required")).toBeVisible();
  await edits();
  const save = page.getByRole("button", { name: "检查并保存" });
  if (!(await save.isVisible())) return;
  await save.click();
  const review = page.getByRole("dialog", { name: "保存前检查" });
  await review.getByLabel(/理由/).fill(reason);
  await review.getByRole("button", { name: "保存", exact: true }).click();
  await stepUpIfAsked(page);
  await expect(review).toBeHidden();
}

async function setSwitch(page: Page, key: string, want: boolean): Promise<void> {
  const sw = page.getByTestId(`setting-${key}`).getByRole("switch");
  if ((await sw.isChecked()) !== want) await sw.click();
}

async function setDeadline(page: Page, value: string): Promise<void> {
  const box = page.getByTestId("setting-email_binding_deadline").getByRole("textbox");
  if ((await box.inputValue()) !== value) await box.fill(value);
}

/** 64x64 的渐变 PNG,不依赖图片库。 */
function makePng(size = 64): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      raw[row + 1 + x * 3] = (x * 4) & 0xff;
      raw[row + 2 + x * 3] = (y * 4) & 0xff;
      raw[row + 3 + x * 3] = 128;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- a. 管理员邀请码 ---------- */

test("admin batch invite codes: shown once with a CSV, one-time use, a revoked code is refused", async ({ browser, request }) => {
  const { context, page } = await adminPage(browser);
  try {
    await page.goto("/admin/invites");
    await page.getByRole("button", { name: "批量新建" }).click();
    const form = page.getByRole("dialog", { name: "批量新建邀请码" });
    await form.getByLabel(/数量/).fill("3");
    await form.getByLabel("标签", { exact: true }).fill("e2e");
    await form.getByRole("button", { name: "生成" }).click();

    const result = page.getByRole("dialog", { name: "已生成 3 个邀请码" });
    await expect(result).toBeVisible();
    const codes = (await result.locator("code").allInnerTexts()).map((c) => c.trim());
    expect(codes).toHaveLength(3);
    remember(...codes);

    const [download] = await Promise.all([page.waitForEvent("download"), result.getByRole("button", { name: "下载 CSV" }).click()]);
    const csv = readFileSync(await download.path(), "utf8");
    expect(csv.charCodeAt(0), "CSV starts with a UTF-8 BOM").toBe(0xfeff);
    expect(csv.slice(1).split("\n")[0].trim()).toBe("code,label,expires_at");
    expect(codes.every((c) => csv.includes(c)), "every code is in the CSV").toBe(true);
    await result.getByRole("button", { name: "我已保存,关闭" }).click();

    // 重新加载:明文码不再出现在页面上;列表里有这一批(标签 e2e)
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: "e2e" }).first()).toBeVisible();
    await assertNoLeak(page);

    // 一次性:第一个码注册成功,同一个码再注册被拒绝
    const first = await registerWithEmailViaApi(request, codes[0]);
    expect(first.userId).toBeTruthy();
    const again = await registerRaw(request, codes[0]);
    expect(again.status, "the same batch code again").not.toBe(200);

    // 撤销批量中一个仍可用的码。列表行无法对应到明文码,所以剩下两个码里恰好一个成功、一个被拒绝
    const row = page.getByRole("row").filter({ hasText: "e2e" }).filter({ hasText: "可用" }).first();
    await row.getByRole("button", { name: "撤销", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "撤销邀请码" });
    await confirm.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(confirm).toBeHidden();

    const outcomes = [(await registerRaw(request, codes[1])).status, (await registerRaw(request, codes[2])).status];
    expect(outcomes.filter((s) => s === 200)).toHaveLength(1);
    expect(outcomes.filter((s) => s !== 200)).toHaveLength(1);
  } finally {
    await context.close();
  }
});

/* ---------- b. 用户邀请卡 ---------- */

test("user invite card: used / cap, no code shown, revoke and replace need a reason", async ({ browser, request }) => {
  const owner = await registerWithEmailViaApi(request, INVITE);
  const mine = await request.post("/api/me/invite", { headers: bearer(owner.token) });
  expect(mine.status(), "generate my invite code").toBe(200);
  const ownCode = String((await mine.json()).code);
  remember(ownCode);

  // 收回:需要理由;之后用户的码不能再注册,用户 API 显示已收回
  const { context, page } = await adminPage(browser);
  try {
    await page.goto(`/admin/users/${owner.userId}`);
    const card = page.getByRole("region", { name: "邀请码" });
    await expect(card.getByText("已用 0 / 上限")).toBeVisible();
    await assertNoLeak(page);

    await card.getByRole("button", { name: "撤销", exact: true }).click();
    const revoke = page.getByRole("dialog", { name: "撤销用户邀请码" });
    await revoke.getByLabel(/理由/).fill("E2E 收回用户码");
    await revoke.getByRole("button", { name: "撤销", exact: true }).click();
    await stepUpIfAsked(page);
    await expect(revoke).toBeHidden();
    await expect(card.getByText("已撤销该用户的邀请码")).toBeVisible();
  } finally {
    await context.close();
  }
  expect((await registerRaw(request, ownCode)).status, "the revoked code").not.toBe(200);
  const view = await request.get("/api/me/invite", { headers: bearer(owner.token) });
  expect(view.status()).toBe(200);
  // 收回后没有可用的码:接口不再返回 code(null);明文码也不在任何字段里
  const viewBody = (await view.json()) as { code?: string | null };
  expect(viewBody.code ?? null, "no live code after revoke").toBeNull();
  expect(JSON.stringify(viewBody).includes(ownCode), "the revoked code is not returned").toBe(false);

  // 更换:用户的已用次数沿用;旧码失效;新码只给用户本人,且可以注册
  const holder = await registerWithEmailViaApi(request, INVITE);
  const issued = await request.post("/api/me/invite", { headers: bearer(holder.token) });
  expect(issued.status()).toBe(200);
  const oldCode = String((await issued.json()).code);
  remember(oldCode);
  await registerWithEmailViaApi(request, oldCode);

  const admin = await adminPage(browser);
  try {
    await admin.page.goto(`/admin/users/${holder.userId}`);
    const card = admin.page.getByRole("region", { name: "邀请码" });
    await expect(card.getByText("已用 1 / 上限")).toBeVisible();
    await card.getByRole("button", { name: "更换", exact: true }).click();
    const replace = admin.page.getByRole("dialog", { name: "更换用户邀请码" });
    await replace.getByLabel(/理由/).fill("E2E 更换用户码");
    await replace.getByRole("button", { name: "更换", exact: true }).click();
    await stepUpIfAsked(admin.page);
    await expect(replace).toBeHidden();
    await expect(card.getByText("已更换;新码只显示给用户本人")).toBeVisible();
    await assertNoLeak(admin.page);
  } finally {
    await admin.context.close();
  }

  expect((await registerRaw(request, oldCode)).status, "the replaced code").not.toBe(200);
  const fresh = await request.get("/api/me/invite", { headers: bearer(holder.token) });
  // 管理员更换后,新码只在用户自己的视图里(顶层 code 字段)
  const freshBody = (await fresh.json()) as { code?: string | null; uses?: number };
  const newCode = String(freshBody.code ?? "");
  expect(freshBody.uses, "the used count carries over").toBe(1);
  expect(newCode, "the owner sees the new code").not.toBe("");
  expect(newCode).not.toBe(oldCode);
  remember(newCode);
  const next = await registerWithEmailViaApi(request, newCode);
  expect(next.userId).toBeTruthy();
});

/* ---------- c. 邮箱卡与用户列表筛选 ---------- */

test("email card: masked address, list filter, clear email needs a reason and unbinds", async ({ browser, request }) => {
  const user = await registerWithEmailViaApi(request, INVITE);
  remember(user.email);
  const masked = `${user.email.charAt(0)}***@example.com`;

  const { context, page } = await adminPage(browser);
  try {
    await page.goto(`/admin/users/${user.userId}`);
    const card = page.getByRole("region", { name: "绑定邮箱" });
    await expect(card.getByText(masked)).toBeVisible();
    await expect(card.getByText("已验证")).toBeVisible();
    expect((await page.content()).includes(user.email), "the full address is not shown").toBe(false);

    // 列表:按用户名搜索,切换邮箱筛选
    await page.goto("/admin/users");
    await page.locator("#user-search").fill(user.username);
    const emailGroup = page.getByRole("group", { name: "邮箱" });
    await emailGroup.getByRole("button", { name: "已绑定邮箱" }).click();
    await expect(page.locator("a").filter({ hasText: user.username }).first()).toBeVisible();
    await emailGroup.getByRole("button", { name: "未绑定邮箱" }).click();
    await expect(page.locator("a").filter({ hasText: user.username })).toHaveCount(0);
    await emailGroup.getByRole("button", { name: "全部" }).click();
    await expect(page.locator("a").filter({ hasText: user.username }).first()).toBeVisible();

    // 清除邮箱:理由 + 二次验证;之后显示未绑定
    await page.goto(`/admin/users/${user.userId}`);
    await page.getByRole("region", { name: "绑定邮箱" }).getByRole("button", { name: "清除邮箱" }).click();
    const clear = page.getByRole("dialog", { name: "清除邮箱" });
    await clear.getByLabel(/理由/).fill("E2E 清除邮箱");
    await clear.getByRole("button", { name: "清除邮箱", exact: true }).click();
    await stepUpIfAsked(page);
    await expect(clear).toBeHidden();
    await expect(page.getByRole("region", { name: "绑定邮箱" }).getByText("已清除邮箱")).toBeVisible();
    await expect(page.getByRole("region", { name: "绑定邮箱" }).getByText("未绑定", { exact: true })).toBeVisible();
    await assertNoLeak(page);
  } finally {
    await context.close();
  }
});

/* ---------- d. 强制绑定(关键安全流程) ---------- */

test("forced binding: enforced blocks the API, the web forces the bind page, pending only shows a banner", async ({ browser, request }) => {
  const bound = await registerWithEmailViaApi(request, INVITE); // 已绑定,不受影响
  const admin = await adminPage(browser);
  const web = await browser.newContext({ locale: "zh-CN" });
  const page = await web.newPage();
  const mocks = await mockUpstreams(page);
  try {
    // 1. 关闭邮箱注册,造两个未绑定账号,然后立即恢复
    await editAccountSettings(admin.page, "E2E 造未绑定账号", () => setSwitch(admin.page, "email_registration_required", false));
    let unboundA: Awaited<ReturnType<typeof registerUnbound>>;
    let unboundB: Awaited<ReturnType<typeof registerUnbound>>;
    try {
      unboundA = await registerUnbound(request, INVITE);
      unboundB = await registerUnbound(request, INVITE);
    } finally {
      await editAccountSettings(admin.page, "E2E 恢复邮箱注册", () => setSwitch(admin.page, "email_registration_required", true));
    }

    // 2. 强制绑定开启,截止时间留空 = 立即强制
    await editAccountSettings(admin.page, "E2E 强制绑定立即生效", async () => {
      await setSwitch(admin.page, "email_binding_required", true);
      await setDeadline(admin.page, "");
    });

    const enforced = await request.get("/api/me", { headers: bearer(unboundA.token) });
    expect(enforced.status()).toBe(200);
    expect((await enforced.json()).email_binding.state).toBe("enforced");
    const sendBind = await request.post("/api/me/email/code", { headers: bearer(unboundA.token), data: { email: newEmail("bind") } });
    expect(sendBind.status(), "binding code still sends while enforced").toBe(200);
    const blockedGet = await request.get("/api/conversations", { headers: bearer(unboundA.token) });
    expect(blockedGet.status()).toBe(403);
    expect(await blockedGet.json()).toEqual({ error: "email_binding_required" });
    const blockedPatch = await request.patch("/api/me", { headers: bearer(unboundA.token), data: { nickname: "x" } });
    expect(blockedPatch.status()).toBe(403);
    expect(await blockedPatch.json()).toEqual({ error: "email_binding_required" });
    expect((await request.get("/api/conversations", { headers: bearer(bound.token) })).status(), "bound user unaffected").toBe(200);

    // 3. 网页端:未绑定账号访问页面都被挡到绑定页;绑定后放行
    await loginViaUi(page, unboundA.username, unboundA.password);
    await expect(page).toHaveURL(/\/account\/email\?required=1/);
    await page.goto("/practice");
    await expect(page).toHaveURL(/\/account\/email/);
    await page.goto("/rooms");
    await expect(page).toHaveURL(/\/account\/email/);

    const bindEmail = newEmail("bindweb");
    remember(bindEmail);
    await page.getByLabel("邮箱", { exact: true }).fill(bindEmail);
    await page.getByRole("button", { name: "发送验证码" }).click();
    await page.locator("#bind-code").fill(codeFor(bindEmail, "bind"));
    await page.getByRole("button", { name: "绑定", exact: true }).click();
    await expect(page.getByTestId("bind-error")).toHaveCount(0);
    await page.goto("/practice");
    await expect(page).toHaveURL(/\/practice$/);

    // 4. 截止时间之前:只显示横幅与「去绑定」,请求不被挡
    await editAccountSettings(admin.page, "E2E 截止前的待绑定", () =>
      setDeadline(admin.page, new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()));
    const pending = await request.get("/api/me", { headers: bearer(unboundB.token) });
    expect((await pending.json()).email_binding.state).toBe("pending");
    expect((await request.get("/api/conversations", { headers: bearer(unboundB.token) })).status()).toBe(200);
    // 第二个用户用单独的上下文(不与第一个用户共享登录态)
    const webB = await browser.newContext({ locale: "zh-CN" });
    const pageB = await webB.newPage();
    const mocksB = await mockUpstreams(pageB);
    try {
      await loginViaUi(pageB, unboundB.username, unboundB.password);
      await expect(pageB).toHaveURL(HOME_URL); // 登录完成后落在首页,不挡
      await expect(pageB.getByTestId("binding-banner")).toBeVisible();
      await expect(pageB.getByTestId("binding-banner").getByRole("link", { name: "去绑定" })).toBeVisible();
      expect(unexpected(mocksB.unmocked), "no unexpected upstream request (web B)").toEqual([]);
    } finally {
      await webB.close();
    }

    // 5. 关闭开关:未绑定账号又能正常使用
    await editAccountSettings(admin.page, "E2E 关闭强制绑定", async () => {
      await setSwitch(admin.page, "email_binding_required", false);
      await setDeadline(admin.page, "");
    });
    expect((await (await request.get("/api/me", { headers: bearer(unboundB.token) })).json()).email_binding.state).toBe("none");
    expect((await request.get("/api/conversations", { headers: bearer(unboundB.token) })).status()).toBe(200);
    expect(unexpected(mocks.unmocked), "no unexpected upstream request (web A)").toEqual([]);
  } finally {
    // 无论中途哪步失败,都把两个热开关恢复到默认
    await editAccountSettings(admin.page, "E2E 恢复默认", async () => {
      await setSwitch(admin.page, "email_binding_required", false);
      await setSwitch(admin.page, "email_registration_required", true);
      await setDeadline(admin.page, "");
    }).catch((): void => undefined);
    await web.close().catch((): void => undefined);
    await admin.context.close().catch((): void => undefined);
  }
});

/* ---------- e. 头像举报与移除 ---------- */

test("avatar reports: report, idempotent, same 404 for strangers, admin removes the avatar", async ({ browser, request }) => {
  const a = await registerWithEmailViaApi(request, INVITE);
  const b = await registerWithEmailViaApi(request, INVITE);
  const stranger = await registerWithEmailViaApi(request, INVITE);

  const up = await request.post("/api/me/avatar", {
    headers: bearer(a.token),
    multipart: { file: { name: "avatar.png", mimeType: "image/png", buffer: makePng() } },
  });
  expect(up.status(), "avatar upload").toBe(200);
  const avatarUrl = String((await up.json()).avatar_url);
  const avatarId = /avatars\/([0-9a-f]+)/.exec(avatarUrl)?.[1] ?? "";
  expect(avatarId).not.toBe("");

  // 共享一个房间(只走房间 HTTP 接口;房间 AI 关闭)
  const room = await request.post("/api/rooms", { headers: bearer(a.token), data: {} });
  expect(room.status(), "create room").toBe(200);
  const code = String((await room.json()).room.code);
  const joined = await request.post("/api/rooms/join", { headers: bearer(b.token), data: { code } });
  expect(joined.status(), "join room").toBe(200);

  const report = (token: string, userId: number | string) =>
    request.post("/api/avatar-reports", { headers: bearer(token), data: { user_id: userId, reason: "inappropriate" } });
  expect((await report(b.token, Number(a.userId))).status(), "first report with a number").toBe(201);
  expect((await report(b.token, Number(a.userId))).status(), "a second report is 200").toBe(200);
  expect((await report(b.token, a.userId)).status(), "the string form is accepted").toBe(200);

  const strangerReport = await report(stranger.token, Number(a.userId));
  const unknownReport = await report(stranger.token, 987654321);
  expect(strangerReport.status()).toBe(404);
  expect(unknownReport.status()).toBe(404);
  expect(await strangerReport.json()).toEqual(await unknownReport.json());

  const { context, page } = await adminPage(browser);
  try {
    await page.goto("/admin/avatar-reports");
    const row = page.getByRole("row").filter({ hasText: a.username });
    await expect(row).toBeVisible();
    // 缩略图装饰性,alt 为空(角色是 presentation),按 src 找
    await expect(row.locator(`img[src*="/api/avatars/${avatarId}"]`)).toBeVisible();
    await expect(row.getByText("不当内容")).toBeVisible();
    await row.getByRole("button", { name: "移除头像" }).click();
    const dialog = page.getByRole("dialog", { name: "移除头像" });
    await dialog.getByLabel(/理由/).fill("E2E 移除违规头像");
    await dialog.getByRole("button", { name: "移除头像", exact: true }).click();
    await stepUpIfAsked(page);
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/已移除头像/)).toBeVisible();

    expect((await request.get(`/api/avatars/${avatarId}`)).status()).toBe(404);
    const me = await (await request.get("/api/me", { headers: bearer(a.token) })).json();
    expect(me.avatar_url ?? null).toBeNull();

    await page.getByText("已处理", { exact: true }).click(); // 分段控件是文字按钮,没有可靠的角色
    await expect(page.getByRole("row").filter({ hasText: a.username })).toBeVisible();
    await assertNoLeak(page);
  } finally {
    await context.close();
  }
});

/* ---------- f. 诊断 ---------- */

test("diagnostics: no email_not_configured, no plain values on the pages we open", async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  try {
    await page.goto("/admin/settings");
    await expect(page.getByRole("navigation", { name: "设置分组" })).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text.includes("邮箱功能需要发信方式"), "no email_not_configured finding").toBe(false);
    await assertNoLeak(page);
    for (const path of ["/admin/invites", "/admin/users", "/admin/avatar-reports"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await assertNoLeak(page);
    }
  } finally {
    await context.close();
  }
});
