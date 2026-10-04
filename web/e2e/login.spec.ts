import { expect, test } from "@playwright/test";
import { INVITE_CODE, loginViaUi, newCredentials, registerViaApi } from "./support/auth";

test("register in the UI, log out and log back in", async ({ page }) => {
  const { username, password } = newCredentials();
  await page.goto("/login");
  await page.getByTestId("login-mode-toggle").click();
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("register-invite").fill(INVITE_CODE);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/practice$/);
  await page.getByTestId("nav-me").click();
  await expect(page.getByTestId("me-username")).toHaveText(username);
  await page.getByTestId("me-logout").click();
  await expect(page).toHaveURL(/\/login$/);
  await loginViaUi(page, username, password);
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
