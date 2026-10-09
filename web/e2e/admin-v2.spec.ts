import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { signIn } from "./support/auth";

/**
 * 管理后台 v2(计划 2026-10-09 Z1):热切换 + 撤销、段位规则发布、维护模式横幅、审计哈希链。
 * 只打自家后端(不调用任何上游,零费用)。需要 E2E 栈启用管理端:E2E_ADMIN_PASSWORD(≥ 12 位)与 ADMIN_COOKIE_SECURE=false。
 * 管理端只做桌面(≥ 1024px),所以后台在单独的桌面上下文里操作;网页端用项目默认的手机设备。
 * 用例按顺序执行(最后一条检查前面三类操作的审计)。
 */
const ADMIN = { username: process.env.E2E_ADMIN_USERNAME ?? "root", password: process.env.E2E_ADMIN_PASSWORD ?? "" };

test.describe.configure({ mode: "serial" });
test.skip(!ADMIN.password, "E2E_ADMIN_PASSWORD not set");

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
    return; // still within the step-up window
  }
  await dialog.getByLabel("密码").fill(ADMIN.password);
  await dialog.getByRole("button", { name: "验证并继续" }).click();
  await expect(dialog).toBeHidden();
}

const roomsTab = (web: Page) => web.getByTestId("nav-rooms");
/** 网页端界面语言默认跟随浏览器(这里两种文案都认) */
const READ_ONLY_BANNER = /维护中:暂时只能查看|Maintenance: read-only for now/;

test("hot toggle ROOMS_ENABLED off, the web nav follows, revert brings it back", async ({ browser, page: web, request }) => {
  await signIn(web, request);
  await expect(roomsTab(web)).toHaveCount(1);
  const { context, page } = await adminPage(browser);
  try {
    await page.goto("/admin/settings/features");
    await page.getByTestId("flag-rooms_enabled").getByRole("switch").click();
    await page.getByRole("button", { name: "检查并保存" }).click();
    const review = page.getByRole("dialog", { name: "保存前检查" });
    await review.getByLabel(/理由/).fill("E2E 验证热切换");
    await review.getByLabel("输入 ROOMS_ENABLED 以确认").fill("ROOMS_ENABLED");
    await review.getByRole("button", { name: "保存" }).click();
    await stepUpIfAsked(page);
    await expect(page.getByText(/已保存.修订 #\d+./)).toBeVisible();

    await web.reload();
    await expect(web.getByTestId("nav-practice")).toBeVisible();
    await expect(roomsTab(web)).toHaveCount(0);

    await page.getByRole("button", { name: "历史" }).click();
    await page.getByRole("button", { name: "撤销此修订" }).first().click();
    const confirm = page.getByRole("dialog", { name: /撤销修订/ });
    await confirm.getByLabel("理由").fill("E2E 撤销");
    await confirm.getByRole("button", { name: "撤销此修订" }).click();
    // reverting a dangerous key asks for the typed key once more
    const typing = confirm.getByLabel("输入 ROOMS_ENABLED 以确认");
    const asked = await typing.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false);
    if (asked) {
      await typing.fill("ROOMS_ENABLED");
      await confirm.getByRole("button", { name: "撤销此修订" }).click();
    }
    await stepUpIfAsked(page);
    await expect(confirm).toBeHidden();

    await web.reload();
    await expect(roomsTab(web)).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("rank rules: new draft, daily cap 80, simulate, publish; the ladder is unchanged", async ({ browser, page: web, request }) => {
  const { token } = await (async () => {
    const r = await signIn(web, request);
    const s = await request.post("/api/sessions", { data: { username: r.username, password: r.password } });
    return { token: (await s.json()).access_token as string };
  })();
  const headers = { Authorization: `Bearer ${token}` };
  const before = await (await request.get("/api/rank/config", { headers })).json();
  const { context, page } = await adminPage(browser);
  try {
    await page.goto("/admin/rank/rules");
    await page.getByRole("button", { name: "新建草稿" }).click();
    const cap = page.getByLabel("每日上限(跟读/对话/复习合计)");
    await cap.fill("80");
    await page.getByRole("button", { name: "保存草稿" }).click();
    await expect(page.getByText("草稿已保存")).toBeVisible();
    await page.getByRole("button", { name: "预演" }).first().click();
    await expect(page.getByRole("region", { name: "影响预演" }).or(page.getByText("影响预演")).first()).toBeVisible();
    await page.getByRole("button", { name: "校验" }).click();
    await page.getByRole("button", { name: "发布" }).click();
    const dialog = page.getByRole("dialog", { name: "发布段位规则" });
    await dialog.getByLabel("理由").fill("E2E 发布段位规则");
    await dialog.getByRole("button", { name: "确认" }).click();
    await stepUpIfAsked(page);
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/v1 ·/).first()).toBeVisible();

    const after = await (await request.get("/api/rank/config", { headers })).json();
    expect(after.tiers).toEqual(before.tiers);
    await web.goto("/rank");
    await expect(web.getByTestId("rank-hero")).toBeVisible();

    // after a publish the six RANK_* settings are read-only in the settings editor
    await page.goto("/admin/settings/rank");
    await expect(page.getByText("由段位规则管理").first()).toBeVisible();
  } finally {
    await context.close();
  }
});

test("maintenance read-only shows the web banner and refuses writes, then back to off", async ({ browser, page: web, request }) => {
  const creds = await signIn(web, request);
  const s = await request.post("/api/sessions", { data: { username: creds.username, password: creds.password } });
  const headers = { Authorization: `Bearer ${(await s.json()).access_token as string}` };
  const { context, page } = await adminPage(browser);
  try {
    await page.goto("/admin/announcements");
    await page.getByRole("radio", { name: "只读" }).click();
    await page.getByRole("button", { name: "应用维护模式" }).click();
    const dialog = page.getByRole("dialog", { name: "切换维护模式" });
    await dialog.getByLabel("理由").fill("E2E 维护演练");
    await dialog.getByLabel("输入 MAINTENANCE_MODE 以确认").fill("MAINTENANCE_MODE");
    await dialog.getByRole("button", { name: "确认" }).click();
    await stepUpIfAsked(page);
    await expect(dialog).toBeHidden();

    // GET /api/announcements is browser-cacheable for 60 s (Cache-Control max-age=60): reload until it shows
    await expect(async () => {
      await web.reload();
      await expect(web.getByText(READ_ONLY_BANNER)).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 90_000, intervals: [5_000] });
    const refused = await request.post("/api/conversations", { headers, data: { name: "x", config: {} } });
    expect(refused.status()).toBe(503);
    expect(await refused.json()).toEqual({ error: "Maintenance" });

    await page.getByRole("radio", { name: "关闭" }).click();
    await page.getByRole("button", { name: "应用维护模式" }).click();
    const off = page.getByRole("dialog", { name: "切换维护模式" });
    await off.getByLabel("理由").fill("E2E 维护结束");
    await off.getByRole("button", { name: "确认" }).click();
    await expect(off).toBeHidden();
    await expect(async () => {
      await web.reload();
      await expect(web.getByTestId("nav-practice")).toBeVisible({ timeout: 5_000 });
      await expect(web.getByText(READ_ONLY_BANNER)).toHaveCount(0, { timeout: 1_000 });
    }).toPass({ timeout: 90_000, intervals: [5_000] });
  } finally {
    await context.close();
  }
});

test("audit log lists the three kinds of changes and the hash chain is intact", async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  try {
    await page.goto("/admin/audit");
    await expect(page.getByText("哈希链完整")).toBeVisible();
    for (const action of ["settings.revert", "rank.rules.publish", "maintenance.set"]) {
      await expect(page.getByText(action).first()).toBeVisible();
    }
  } finally {
    await context.close();
  }
});
