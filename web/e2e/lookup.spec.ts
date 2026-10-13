import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/auth";
import { SPEECH_REFERENCE, SPEECH_WAV } from "./support/fake-mic";

/**
 * Programmatic selection: build a Range over the text node inside the `[data-testid]` element,
 * install it with the Selection API and dispatch `selectionchange` ourselves (the app listens to
 * that event on `document` and debounces it by 300 ms, so callers wait for the trigger button with
 * a web-first assertion instead of sleeping). `needle === null` selects the whole text node.
 */
async function selectIn(page: Page, testId: string, needle: string | null) {
  await page.evaluate(([id, n]) => {
    const node = document.querySelector(`[data-testid="${id}"]`)!.firstChild as Text;
    const text = node.textContent!;
    const start = n ? text.indexOf(n) : 0;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, n ? start + n.length : text.length);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, [testId, needle] as const);
}

async function openDrawerFor(page: Page, needle: string | null) {
  await selectIn(page, "assessment-reference", needle);
  await page.getByTestId("lookup-trigger").click();
}

test("look up a word (dictionary) and translate a sentence, translation served from cache the second time", async ({ page, request }) => {
  const { token } = await signIn(page, request);
  const saved = await request.post("/api/speech/assessments", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: "jfk.wav", mimeType: "audio/wav", buffer: readFileSync(SPEECH_WAV) },
      reference: SPEECH_REFERENCE, language: "en-US", save: "true",
    },
    timeout: 150_000,
  });
  expect(saved.status(), await saved.text()).toBe(200);
  const id = (await saved.json()).assessment_id as string;

  await page.getByTestId("nav-me").click();
  await page.getByTestId("me-language").selectOption("zh-CN");

  // Count every LLM request the page issues. (page.route + continue() is not used for counting:
  // in Playwright's WebKit the route handler did not run for this fetch although the request was sent.)
  let aiCalls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ai/chat/completions")) aiCalls++;
  });

  await page.goto(`/practice/assessments/${id}`);
  await expect(page.getByTestId("assessment-reference")).toBeVisible();
  const result = page.getByTestId("lookup-result");

  // 1) word lookup: answered by the local dictionary (the E2E stack ships the dictionary files), no LLM request
  await openDrawerFor(page, "country");
  await expect(result).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(result).toContainText(/[一-鿿]/);
  await expect(page.getByTestId("lookup-drawer")).toContainText(/country/i);
  await expect(page.getByTestId("lookup-source")).toHaveAttribute("data-source", "dict");
  expect(aiCalls).toBe(0);
  const wordResult = (await result.innerText()).trim();
  expect(wordResult).not.toBe("");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lookup-drawer")).toBeHidden();

  // 2) whole sentence: translation, the first LLM request
  await openDrawerFor(page, null);
  await expect(result).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(result).toContainText(/[一-鿿]/);
  expect(aiCalls).toBe(1);
  const sentenceResult = (await result.innerText()).trim();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lookup-drawer")).toBeHidden();

  // 3) same word again: the dictionary answers again (dictionary hits do not use the AI; the translation is cached); do not compare the whole text (not cached, carries the user preference)
  await openDrawerFor(page, "country");
  await expect(result).toHaveAttribute("data-status", "done");
  await expect(result).toContainText(/[一-鿿]/);
  expect(aiCalls).toBe(1);

  const box = await page.getByTestId("lookup-drawer").boundingBox();
  expect(box!.height).toBeLessThanOrEqual(page.viewportSize()!.height * 0.7 + 1);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lookup-drawer")).toBeHidden();

  // 4) the translation cache is persistent: after a full reload the sentence is still served without an LLM request
  await page.reload();
  await expect(page.getByTestId("assessment-reference")).toBeVisible();
  await openDrawerFor(page, "country");
  await expect(result).toHaveAttribute("data-status", "done");
  await expect(result).toContainText(/[一-鿿]/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lookup-drawer")).toBeHidden();
  await openDrawerFor(page, null);
  await expect(result).toHaveAttribute("data-status", "done");
  expect((await result.innerText()).trim()).toBe(sentenceResult);
  expect(aiCalls).toBe(1);
});

test("practice and save a selected sentence from the lookup drawer", async ({ page, request }) => {
  const { token } = await signIn(page, request);
  const saved = await request.post("/api/speech/assessments", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { file: { name: "jfk.wav", mimeType: "audio/wav", buffer: readFileSync(SPEECH_WAV) }, reference: SPEECH_REFERENCE, language: "en-US", save: "true" },
    timeout: 150_000,
  });
  expect(saved.status(), await saved.text()).toBe(200);
  await page.goto(`/practice/assessments/${(await saved.json()).assessment_id}`);
  await expect(page.getByTestId("assessment-reference")).toBeVisible();
  await openDrawerFor(page, null);
  await expect(page.getByTestId("lookup-result")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  const added = page.waitForResponse((r) => r.url().endsWith("/api/practice-items") && r.request().method() === "POST");
  await page.getByTestId("lookup-save").click();
  expect((await added).status()).toBe(200);
  await page.getByTestId("lookup-practice").click();
  await expect(page).toHaveURL(/\/practice$/);
  await expect(page.getByTestId("reference-input")).toHaveValue(SPEECH_REFERENCE);
  await page.getByTestId("practice-list").click();
  await expect(page.getByTestId("practice-item")).toContainText("ask not what your country can do for you");
});

test("explain a looked-up word in context with the AI", async ({ page, request }) => {
  const { token } = await signIn(page, request);
  const saved = await request.post("/api/speech/assessments", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { file: { name: "jfk.wav", mimeType: "audio/wav", buffer: readFileSync(SPEECH_WAV) }, reference: SPEECH_REFERENCE, language: "en-US", save: "true" },
    timeout: 150_000,
  });
  expect(saved.status(), await saved.text()).toBe(200);
  let aiCalls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ai/chat/completions")) aiCalls++;
  });
  await page.goto(`/practice/assessments/${(await saved.json()).assessment_id}`);
  await expect(page.getByTestId("assessment-reference")).toBeVisible();
  await openDrawerFor(page, "country");
  await expect(page.getByTestId("lookup-result")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await page.getByTestId("lookup-ai-explain").click();
  await expect(page.getByTestId("lookup-ai-result")).toBeVisible({ timeout: 60_000 });
  expect(aiCalls).toBe(1);
});
