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

test("look up a word and translate a sentence, served from cache the second time", async ({ page, request }) => {
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

  // 1) word lookup: exactly one LLM request, structured non-empty Chinese result
  await openDrawerFor(page, "country");
  await expect(result).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(result).toContainText(/[一-鿿]/);
  await expect(page.getByTestId("lookup-drawer")).toContainText(/country/i);
  expect(aiCalls).toBe(1);
  const wordResult = (await result.innerText()).trim();
  expect(wordResult).not.toBe("");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lookup-drawer")).toBeHidden();

  // 2) whole sentence: translation, one more request
  await openDrawerFor(page, null);
  await expect(result).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(result).toContainText(/[一-鿿]/);
  expect(aiCalls).toBe(2);
  const sentenceResult = (await result.innerText()).trim();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lookup-drawer")).toBeHidden();

  // 3) same word again: identical result straight from the IndexedDB cache, zero new requests
  await openDrawerFor(page, "country");
  await expect(result).toHaveAttribute("data-status", "done");
  expect((await result.innerText()).trim()).toBe(wordResult);
  expect(aiCalls).toBe(2);

  const box = await page.getByTestId("lookup-drawer").boundingBox();
  expect(box!.height).toBeLessThanOrEqual(page.viewportSize()!.height * 0.7 + 1);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lookup-drawer")).toBeHidden();

  // 4) the cache is persistent: after a full reload both results are still served without a request
  await page.reload();
  await expect(page.getByTestId("assessment-reference")).toBeVisible();
  await openDrawerFor(page, "country");
  await expect(result).toHaveAttribute("data-status", "done");
  expect((await result.innerText()).trim()).toBe(wordResult);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lookup-drawer")).toBeHidden();
  await openDrawerFor(page, null);
  await expect(result).toHaveAttribute("data-status", "done");
  expect((await result.innerText()).trim()).toBe(sentenceResult);
  expect(aiCalls).toBe(2);
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
