import { expect, test } from "@playwright/test";
import { newAccount, registerInUi } from "./support/accounts";
import { loginViaUi, registerViaApi } from "./support/auth";

test("register in the UI (email code), log out and log back in by username or email", async ({ page }) => {
  // 注册页是两步:邮箱发码 -> 验证码 + 用户名 + 昵称 + 密码 + 邀请码。登录页已没有「注册」切换。
  const account = await registerInUi(page, newAccount());
  await page.getByTestId("nav-me").click();
  await expect(page.getByTestId("me-username")).toHaveText(account.username);
  await page.getByTestId("me-logout").click();
  await expect(page).toHaveURL(/\/login$/);
  await loginViaUi(page, account.username, account.password);
  await expect(page).toHaveURL(/\/practice$/);
  await page.getByTestId("nav-me").click();
  await page.getByTestId("me-logout").click();
  await expect(page).toHaveURL(/\/login$/);
  // 登录框同时接受用户名与邮箱
  await loginViaUi(page, account.email, account.password);
  await expect(page).toHaveURL(/\/practice$/);
});

test("wrong password shows an error", async ({ page, request }) => {
  const { username } = await registerViaApi(request);
  await loginViaUi(page, username, "definitely-wrong");
  await expect(page.getByTestId("login-error")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("deep links survive the login redirect and reloads", async ({ page, request }) => {
  const { username, password } = await registerViaApi(request);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/login$/);
  await loginViaUi(page, username, password);
  await expect(page).toHaveURL(/\/chat$/);
  await page.reload();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByTestId("nav-chat")).toHaveAttribute("aria-current", "page");
});

test("mobile layout constraints", async ({ page, request }) => {
  await page.goto("/login");
  const fontSize = await page.getByTestId("login-username").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
  const { username, password } = await registerViaApi(request);
  await loginViaUi(page, username, password);
  for (const id of ["nav-practice", "nav-chat", "nav-me"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("same-origin hosting basics", async ({ request }) => {
  const missing = await request.get("/api/nope");
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: "Not Found" });
  const manifest = await request.get("/manifest.webmanifest");
  expect((await manifest.json()).display).toBe("standalone");
  expect((await request.get("/sw.js")).status()).toBe(200);
  const deep = await request.get("/practice/history");
  expect(deep.headers()["content-type"]).toContain("text/html");
});
