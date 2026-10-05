import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/auth";
import { SPEECH_REFERENCE, SPEECH_WAV } from "./support/fake-mic";

async function selectIn(page: Page, testId: string, needle: string) {
  await page.evaluate(([id, n]) => {
    const node = document.querySelector(`[data-testid="${id}"]`)!.firstChild as Text;
    const start = node.textContent!.indexOf(n);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + n.length);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, [testId, needle] as const);
}

test("look up a word, add it to the vocabulary book, review it and see the next due date move", async ({ page, request }) => {
  const { token } = await signIn(page, request);
  const saved = await request.post("/api/speech/assessments", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { file: { name: "jfk.wav", mimeType: "audio/wav", buffer: readFileSync(SPEECH_WAV) }, reference: SPEECH_REFERENCE, language: "en-US", save: "true" },
    timeout: 150_000,
  });
  expect(saved.status(), await saved.text()).toBe(200);
  await page.goto(`/practice/assessments/${(await saved.json()).assessment_id}`);
  await expect(page.getByTestId("assessment-reference")).toBeVisible();
  await selectIn(page, "assessment-reference", "country");
  await page.getByTestId("lookup-trigger").click();
  await expect(page.getByTestId("lookup-result")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  const added = page.waitForResponse((r) => r.url().endsWith("/api/vocabulary") && r.request().method() === "POST");
  await page.getByTestId("lookup-vocab").click();
  expect((await added).status()).toBe(200);
  await page.keyboard.press("Escape");

  await page.getByTestId("nav-me").click();
  await page.getByTestId("me-vocabulary").click();
  await expect(page.getByTestId("vocab-due-count")).toContainText("1");
  await page.getByTestId("vocab-start-review").click();
  await expect(page.getByTestId("vocab-card-word")).toHaveText(/country/i);
  await page.getByTestId("vocab-card-flip").click();
  await expect(page.getByTestId("vocab-card-meaning")).not.toBeEmpty();
  const reviewed = page.waitForResponse((r) => r.url().endsWith("/review"));
  await page.getByTestId("vocab-grade-good").click();
  expect((await reviewed).status()).toBe(200);
  await expect(page.getByTestId("vocab-review-done")).toBeVisible();

  const item = await page.evaluate(async () => {
    const t = JSON.parse(localStorage.getItem("enjoy-web.auth")!).token;
    return (await (await fetch("/api/vocabulary", { headers: { Authorization: `Bearer ${t}` } })).json()).vocabulary_items[0];
  });
  expect(item.box).toBe(1);
  const days = (Date.parse(item.due_at) - Date.parse(item.last_reviewed_at)) / 86_400_000;
  expect(days).toBeCloseTo(2, 5);
  console.log(`vocabulary: ${item.word} → box ${item.box}, due ${item.due_at}`);
  await page.getByTestId("vocab-review-close").click();
  await expect(page.getByTestId("vocab-due-count")).toContainText("0");
});
