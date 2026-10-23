import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/auth";
import { dismissGreeting, openHistory } from "./support/chat";
import { mockUpstreams, type UpstreamMocks } from "./support/mock-upstreams";

// 对话主页与每日问候(计划 2026-10-23-chat-home-daily-greeting-web.md §7)。
// 栈要求:CHAT_HOME_ENABLED=true、CHAT_GREETING_LLM_ENABLED=false(模板问候,零上游费用);开关关时整个文件跳过。
// 发消息的用例走路由模拟(mockUpstreams),守卫保证没有请求漏到真实上游。**尚未运行**(见 docs/superpowers/plans/e2e-results.md)。
const SHOWN_KEY = "enjoy.chatHome.shown";

async function homeEnabled(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const token = JSON.parse(localStorage.getItem("enjoy-web.auth")!).token;
    const r = await fetch("/api/chat-home/config", { headers: { Authorization: `Bearer ${token}` } });
    return r.ok && (await r.json()).enabled === true;
  });
}

let mocks: UpstreamMocks;

test.beforeEach(async ({ page, request }) => {
  mocks = await mockUpstreams(page);
  await signIn(page, request);
  test.skip(!(await homeEnabled(page)), "start the E2E stack with CHAT_HOME_ENABLED=true and CHAT_GREETING_LLM_ENABLED=false");
});
test.afterEach(() => {
  expect(mocks.unmocked, `requests that could reach a real upstream: ${mocks.unmocked.join(", ")}`).toEqual([]);
});

const modal = (page: Page) => page.getByTestId("greeting-modal");
const greetingBubbles = (page: Page) => page.getByTestId("chat-greeting-line");

async function enterChat(page: Page): Promise<void> {
  await page.getByTestId("nav-chat").click();
  await expect(page.getByTestId("chat-history-open")).toBeVisible();
}

test("first open pops the greeting; skipping lands in today's chat with three greeting bubbles; a reload does not pop it again", async ({ page }) => {
  await enterChat(page);
  await expect(modal(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("greeting-line")).toHaveCount(3);
  await page.getByTestId("greeting-skip").click();
  await expect(modal(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/chat$/);
  await expect(greetingBubbles(page)).toHaveCount(3);
  await page.reload();
  await expect(greetingBubbles(page)).toHaveCount(3);
  await expect(modal(page)).toHaveCount(0);
});

test("settings: replay shows the greeting again without adding messages", async ({ page }) => {
  await enterChat(page);
  await dismissGreeting(page, 15_000);
  await expect(greetingBubbles(page)).toHaveCount(3);
  const before = await page.getByTestId("message-assistant").count();
  await page.getByTestId("chat-settings-open").click();
  await page.getByTestId("chat-greeting-replay").click();
  await expect(modal(page)).toHaveAttribute("data-mode", "replay");
  await page.getByTestId("greeting-skip").click();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.getByTestId("message-assistant")).toHaveCount(before);
});

test("every open: after a reload (marker cleared) the greeting pops again and the chat keeps its three bubbles", async ({ page }) => {
  await enterChat(page);
  await dismissGreeting(page, 15_000);
  await page.getByTestId("chat-settings-open").click();
  const patched = page.waitForResponse((r) => r.url().endsWith("/api/chat-home/settings") && r.request().method() === "PATCH");
  await page.getByTestId("chat-greeting-trigger-every_open").click();
  expect((await patched).status()).toBe(200);
  await page.getByTestId("chat-settings-done").click();
  await page.evaluate((k) => localStorage.removeItem(k), SHOWN_KEY);
  await page.goto("/practice"); // a cold start (full load), then enter the chat home
  await enterChat(page);
  await expect(modal(page)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("greeting-skip").click();
  await expect(greetingBubbles(page)).toHaveCount(3);
  await expect(page.getByTestId("message-assistant")).toHaveCount(3);
});

test("learning numbers off: the replayed greeting has no numbers line", async ({ page }) => {
  await enterChat(page);
  await dismissGreeting(page, 15_000);
  await page.getByTestId("chat-settings-open").click();
  const patched = page.waitForResponse((r) => r.url().endsWith("/api/chat-home/settings") && r.request().method() === "PATCH");
  await page.getByTestId("chat-greeting-stats").click();
  expect((await patched).status()).toBe(200);
  await expect(page.getByTestId("chat-greeting-stats")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("chat-greeting-replay").click();
  await expect(modal(page)).toBeVisible();
  await expect(page.getByTestId("greeting-stats")).toHaveCount(0);
  await page.getByTestId("greeting-skip").click();
});

test("history drawer: opens, closes on Escape, and deleting today's chat rebuilds it without a popup", async ({ page }) => {
  await enterChat(page);
  await dismissGreeting(page, 15_000);
  await openHistory(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("chat-history-drawer")).toHaveCount(0);
  await expect(page.getByTestId("chat-history-open")).toBeFocused();

  await openHistory(page);
  await page.getByTestId("chat-history-today-delete").click();
  await page.getByTestId("conversation-delete-confirm").click();
  await expect(page.getByTestId("chat-history-drawer")).toHaveCount(0);
  await expect(page).toHaveURL(/\/chat$/);
  await expect(greetingBubbles(page)).toHaveCount(3);
  await expect(modal(page)).toHaveCount(0);
});

test("new chat: a local draft, start chatting, send one message (mocked upstream)", async ({ page }) => {
  await enterChat(page);
  await dismissGreeting(page, 15_000);
  await openHistory(page);
  await page.getByTestId("chat-history-new").click();
  await expect(page).toHaveURL(/\/chat\/new$/);
  await page.getByTestId("chat-new-just-start").click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await page.getByTestId("chat-input").fill("Hello there");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("message-assistant").last()).toHaveAttribute("data-status", "done", { timeout: 30_000 });
});

test("a deep link never pops the greeting; the first visit to /chat afterwards does", async ({ page }) => {
  await page.goto("/chat/new"); // a cold start away from /chat
  await page.getByTestId("chat-new-just-start").click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await page.waitForTimeout(1_500);
  await expect(modal(page)).toHaveCount(0);
  await page.getByTestId("nav-chat").click();
  await expect(modal(page)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("greeting-skip").click();
});
