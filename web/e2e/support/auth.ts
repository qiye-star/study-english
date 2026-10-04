import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const INVITE_CODE = process.env.E2E_INVITE_CODE ?? "";
if (!INVITE_CODE) throw new Error("E2E_INVITE_CODE is not set (see docker-compose.e2e.yml)");

export function newCredentials() {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  return { username: `e2e_${suffix}`, password: "e2e-password-123" };
}

export async function registerViaApi(request: APIRequestContext) {
  const creds = newCredentials();
  const r = await request.post("/api/users", {
    data: { username: creds.username, password: creds.password, invite_code: INVITE_CODE },
  });
  expect(r.status(), await r.text()).toBe(200);
  return { ...creds, token: (await r.json()).access_token as string };
}

export async function loginViaUi(page: Page, username: string, password: string): Promise<void> {
  if (!page.url().includes("/login")) await page.goto("/login");
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

export async function signIn(page: Page, request: APIRequestContext) {
  const creds = await registerViaApi(request);
  await loginViaUi(page, creds.username, creds.password);
  await expect(page).toHaveURL(/\/practice$/);
  return creds;
}
