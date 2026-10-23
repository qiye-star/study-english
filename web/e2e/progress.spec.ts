import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { startChat } from "./support/chat";
import { closeHeaderOptions, headerOption } from "./support/header";

test("the progress page shows today's activity", async ({ page, request }) => {
  await signIn(page, request);
  await startChat(page);
  await (await headerOption(page, "conversation-autospeak")).click(); // 本用例不关心朗读
  await closeHeaderOptions(page);
  await page.getByTestId("chat-input").fill("Hello! How are you today?");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("message-assistant").last()).toHaveAttribute("data-status", "done", { timeout: 90_000 });
  await expect.poll(() => page.evaluate(async () => {
    const t = JSON.parse(localStorage.getItem("enjoy-web.auth")!).token;
    const id = location.pathname.split("/").pop();
    return (await (await fetch(`/api/conversations/${id}/messages`, { headers: { Authorization: `Bearer ${t}` } })).json()).messages.length;
  }), { timeout: 60_000 }).toBe(2);

  await page.getByTestId("nav-practice").click();
  await page.getByTestId("practice-progress").click();
  const stats = page.waitForResponse((r) => r.url().includes("/api/stats?days=7"));
  await expect(page.getByTestId("progress-messages")).toHaveText("1");
  expect((await stats).url()).toMatch(/tz_offset_minutes=-?\d+/);
  await expect(page.getByTestId("progress-active-days")).toHaveText("1");
  await expect(page.getByTestId("progress-streak")).toHaveText("1");
  await expect(page.getByTestId("progress-disclaimer")).toBeVisible();
  await page.getByTestId("progress-days-30").click();
  await expect(page.getByTestId("progress-days-30")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("progress-messages")).toHaveText("1");
});
