import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { SPEECH_REFERENCE, useFakeMicrophone } from "./support/fake-mic";

// 阶段 0 结论(docs/superpowers/plans/2026-10-04-mobile-web-spike-results.md 第 B 节):
// Playwright 的 WebKit 构建(Windows 与 Linux)都没有 MediaRecorder,录音类用例只能在 Chromium 上运行。
const WEBKIT_NO_RECORDER = "Playwright WebKit has no MediaRecorder (see 2026-10-04-mobile-web-spike-results.md, section B)";

test("record, assess with the real service, replay and delete", async ({ page, request, browserName }) => {
  test.skip(browserName === "webkit", WEBKIT_NO_RECORDER);
  await useFakeMicrophone(page, browserName);
  await signIn(page, request);
  await page.goto("/practice/shadow");
  await page.getByTestId("reference-input").fill(SPEECH_REFERENCE);
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("practice-status")).toHaveAttribute("data-state", "recording");
  // 等录满整段素材(约 11 s),以计时器为准而不是固定睡眠
  await expect(page.getByTestId("record-timer")).toHaveText(/^00:(1[1-9]|[2-9]\d) \//, { timeout: 30_000 });
  const assessed = page.waitForResponse(
    (r) => r.url().endsWith("/api/speech/assessments") && r.request().method() === "POST",
    { timeout: 150_000 },
  );
  // 结果页由应用自己带令牌请求录音,这是"回放可用"的真实路径:先挂好监听再点停止
  const appAudio = page.waitForResponse(
    (r) => /\/api\/assessments\/[^/]+\/audio$/.test(r.url()) && r.request().method() === "GET",
    { timeout: 150_000 },
  );
  await page.getByTestId("record-toggle").click();
  const response = await assessed;
  expect(response.status()).toBe(200); // 服务端只接受 16 kHz/单声道/16 位 WAV,200 即格式被接受
  const body = await response.json();
  expect(body.assessment_id).toBeTruthy();
  expect(body.pronunciation_score).toBeGreaterThan(50);
  expect(body.detail_result.words.length).toBeGreaterThan(10);
  console.log(`assessment score=${body.pronunciation_score} words=${body.detail_result.words.length}`);

  await expect(page).toHaveURL(new RegExp(`/practice/assessments/${body.assessment_id}$`));
  await expect(page.getByTestId("assessment-scores")).toBeVisible();
  await expect(page.getByTestId("assessment-words")).toContainText(/country/i);
  const playerAudio = await appAudio;
  expect(playerAudio.status()).toBe(200);
  expect(playerAudio.headers()["content-type"]).toMatch(/audio\/(wav|x-wav|wave)/);
  // 播放器真的加载了应用拿到的 blob:没有"录音不可用"提示,且渲染出波形
  await expect(page.getByTestId("assessment-audio").locator("canvas").first()).toBeVisible();
  await expect(page.getByTestId("assessment-audio")).not.toContainText(/unavailable|不可用/i);
  const audio = await page.evaluate(async (id) => {
    const token = JSON.parse(localStorage.getItem("enjoy-web.auth")!).token;
    const r = await fetch(`/api/assessments/${id}/audio`, { headers: { Authorization: `Bearer ${token}` } });
    const view = new DataView(await r.arrayBuffer());
    return { status: r.status, rate: view.getUint32(24, true), channels: view.getUint16(22, true), bits: view.getUint16(34, true) };
  }, body.assessment_id);
  expect(audio).toEqual({ status: 200, rate: 16000, channels: 1, bits: 16 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await page.goto("/practice/history");
  // signIn 每次注册全新用户,所以该用户历史里只有刚才这一条
  await expect(page.getByTestId("assessment-item")).toHaveCount(1);
  await page.getByTestId("assessment-item").first().click();
  await page.getByTestId("assessment-delete").click();
  await page.getByTestId("assessment-delete-confirm").click();
  await expect(page).toHaveURL(/\/practice\/history$/);
  await expect(page.getByTestId("history-empty")).toBeVisible();
  // 服务端行确实已删除
  const gone = await page.evaluate(async (id) => {
    const token = JSON.parse(localStorage.getItem("enjoy-web.auth")!).token;
    return (await fetch(`/api/assessments/${id}/audio`, { headers: { Authorization: `Bearer ${token}` } })).status;
  }, body.assessment_id);
  expect(gone).toBe(404);
});

test("going to the background keeps what was recorded", async ({ page, request, browserName }) => {
  test.skip(browserName === "webkit", WEBKIT_NO_RECORDER);
  await useFakeMicrophone(page, browserName);
  await signIn(page, request);
  await page.goto("/practice/shadow");
  await page.getByTestId("reference-input").fill(SPEECH_REFERENCE);
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("practice-status")).toHaveAttribute("data-state", "recording");
  await expect(page.getByTestId("record-timer")).toHaveText(/^00:0[2-9] \//, { timeout: 15_000 });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("practice-status")).toHaveAttribute("data-state", "kept");
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }));
  await page.getByTestId("practice-discard").click();
  await expect(page.getByTestId("practice-status")).toHaveAttribute("data-state", "idle");
});

test("listen to the reference before reading", async ({ page, request }) => {
  await signIn(page, request);
  await page.goto("/practice/shadow");
  await page.getByTestId("reference-input").fill(SPEECH_REFERENCE);
  const button = page.getByTestId("practice-listen");
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.evaluate((el) => {
    const w = window as unknown as { __listen: string[] };
    w.__listen = [el.getAttribute("data-state") ?? ""];
    new MutationObserver(() => {
      const s = el.getAttribute("data-state") ?? "";
      if (w.__listen[w.__listen.length - 1] !== s) w.__listen.push(s);
    }).observe(el, { attributes: true, attributeFilter: ["data-state"] });
  });
  const speech = page.waitForResponse((r) => r.url().endsWith("/api/ai/audio/speech"), { timeout: 60_000 });
  await button.click();
  const res = await speech;
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^audio\//);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __listen: string[] }).__listen), { timeout: 30_000 }).toContain("playing");
  expect(await page.evaluate(() => (window as unknown as { __listen: string[] }).__listen)).not.toContain("error");
});
