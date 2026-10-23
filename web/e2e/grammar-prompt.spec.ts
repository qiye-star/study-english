import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/auth";
import { startChat } from "./support/chat";

async function readPrompt(page: Page): Promise<{ prompt: string | null; default_prompt: string; max_length: number }> {
  return page.evaluate(async () => {
    const token = JSON.parse(localStorage.getItem("enjoy-web.auth")!).token;
    return (await fetch("/api/me/grammar-prompt", { headers: { Authorization: `Bearer ${token}` } })).json();
  });
}

test("grammar prompt: prefilled default, save a custom version, check with it, restore the default", async ({ page, request }) => {
  await signIn(page, request);
  await page.getByTestId("nav-me").click();
  await page.getByTestId("me-grammar").click();
  const initial = await readPrompt(page);
  expect(initial.prompt).toBeNull();
  expect(initial.max_length).toBe(2000);
  const input = page.getByTestId("grammar-prompt-input");
  await expect(input).toHaveValue(initial.default_prompt);
  await expect(page.getByTestId("grammar-prompt-status")).toHaveAttribute("data-custom", "false");

  const custom = `${initial.default_prompt}\n- Also point out missing articles.`;
  await input.fill(custom);
  const put = page.waitForResponse((r) => r.url().endsWith("/api/me/grammar-prompt") && r.request().method() === "PUT");
  await page.getByTestId("grammar-prompt-save").click();
  expect((await put).status()).toBe(200);
  await expect(page.getByTestId("grammar-prompt-status")).toHaveAttribute("data-custom", "true");
  expect((await readPrompt(page)).prompt).toBe(custom);

  await startChat(page);
  const grammar = page.waitForResponse((r) => r.url().endsWith("/api/ai/grammar"), { timeout: 120_000 });
  await page.getByTestId("chat-input").fill("I have a apple and she have two.");
  await page.getByTestId("chat-send").click();
  expect((await grammar).status()).toBe(200);
  await expect(page.getByTestId("badge-grammar")).toHaveAttribute("data-status", "done", { timeout: 60_000 });

  await page.getByTestId("nav-me").click();
  await page.getByTestId("me-grammar").click();
  await page.getByTestId("grammar-prompt-reset").click();
  const del = page.waitForResponse((r) => r.url().endsWith("/api/me/grammar-prompt") && r.request().method() === "DELETE");
  await page.getByTestId("grammar-prompt-reset-confirm").click();
  expect((await del).status()).toBe(200);
  await expect(input).toHaveValue(initial.default_prompt);
  expect((await readPrompt(page)).prompt).toBeNull();
});
