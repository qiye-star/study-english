import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { useFakeMicrophone } from "./support/fake-mic";

// 阶段 0 结论(docs/superpowers/plans/2026-10-04-mobile-web-spike-results.md 第 B 节):
// Playwright 的 WebKit 构建没有 MediaRecorder,语音输入只能在 Chromium 上运行。
const WEBKIT_NO_RECORDER = "Playwright WebKit has no MediaRecorder (see 2026-10-04-mobile-web-spike-results.md, section B)";

test("chat: stream, persist, read aloud and delete", async ({ page, request, browserName }) => {
  await useFakeMicrophone(page, browserName);
  await signIn(page, request);
  await page.getByTestId("nav-chat").click();
  await page.getByTestId("conversation-new").click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const conversationId = page.url().split("/").pop()!;

  // 持久化写入(POST .../messages)在流结束后发生;先挂好监听,刷新前等它完成,避免竞态
  const persisted = page.waitForResponse(
    (r) => /\/api\/conversations\/[^/]+\/messages$/.test(r.url()) && r.request().method() === "POST",
    { timeout: 120_000 },
  );
  const streamed = page.waitForResponse((r) => r.url().endsWith("/api/ai/chat/completions"), { timeout: 60_000 });
  await page.getByTestId("chat-input").fill("Hi! Please reply with one short sentence about the weather.");
  await page.getByTestId("chat-send").click();
  expect((await streamed).headers()["content-type"]).toContain("text/event-stream");
  const reply = page.getByTestId("message-assistant").last();
  await expect(reply).toHaveAttribute("data-status", "done", { timeout: 90_000 });
  await expect(reply).toHaveText(/\S/);
  const replyText = (await reply.innerText()).trim();
  expect(replyText).not.toBe("");

  expect((await persisted).ok()).toBe(true);
  // 服务端已持久化:刷新后恢复同样的两条消息,助手回复文本与刷新前一致
  await page.reload();
  await expect(page.getByTestId("message-user")).toHaveCount(1);
  await expect(page.getByTestId("message-assistant")).toHaveCount(1);
  await expect(page.getByTestId("message-assistant")).toHaveText(replyText);

  // 朗读:真实 TTS 请求 200 + audio/*,按钮状态机经过 loading -> playing(无头环境不出声,但会进入播放态)
  const tts = page.getByTestId("message-assistant").locator("xpath=..").getByTestId("message-tts").last();
  await tts.evaluate((el) => {
    const w = window as unknown as { __ttsStates: string[] };
    w.__ttsStates = [el.getAttribute("data-state") ?? ""];
    new MutationObserver(() => {
      const s = el.getAttribute("data-state") ?? "";
      if (w.__ttsStates[w.__ttsStates.length - 1] !== s) w.__ttsStates.push(s);
    }).observe(el, { attributes: true, attributeFilter: ["data-state"] });
  });
  const speech = page.waitForResponse((r) => r.url().endsWith("/api/ai/audio/speech"), { timeout: 60_000 });
  await tts.click();
  const speechResponse = await speech;
  expect(speechResponse.status()).toBe(200);
  expect(speechResponse.headers()["content-type"]).toMatch(/^audio\//);
  // 响应体由应用以 blob 读取,Playwright 的 body() 对它返回空,所以用 content-length 确认确有音频数据
  expect(Number(speechResponse.headers()["content-length"])).toBeGreaterThan(1000);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ttsStates: string[] }).__ttsStates), { timeout: 30_000 })
    .toContain("playing");
  const states = await page.evaluate(() => (window as unknown as { __ttsStates: string[] }).__ttsStates);
  expect(states).not.toContain("error");

  await page.getByTestId("nav-chat").click();
  await expect(page.getByTestId("conversation-item")).toHaveCount(1);
  await page.getByTestId("conversation-delete").first().click();
  await page.getByTestId("conversation-delete-confirm").click();
  await expect(page.getByTestId("conversations-empty")).toBeVisible();
  // 服务端确实删除:刷新后仍为空,且按 id 查询返回 404
  await page.reload();
  await expect(page.getByTestId("conversations-empty")).toBeVisible();
  const gone = await page.evaluate(async (id) => {
    const token = JSON.parse(localStorage.getItem("enjoy-web.auth")!).token;
    return (await fetch(`/api/conversations/${id}`, { headers: { Authorization: `Bearer ${token}` } })).status;
  }, conversationId);
  expect(gone).toBe(404);
});

test("chat: dictation fills the input with the real transcription and does not send", async ({ page, request, browserName }) => {
  test.skip(browserName === "webkit", WEBKIT_NO_RECORDER);
  const completionRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/chat/completions")) completionRequests.push(r.url());
  });
  await useFakeMicrophone(page, browserName);
  await signIn(page, request);
  await page.getByTestId("nav-chat").click();
  await page.getByTestId("conversation-new").click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

  await page.getByTestId("chat-mic").click();
  await expect(page.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording");
  // 素材开头即 "And so, my fellow Americans, ask not ...";录制期间没有可观察的进度信号,按时钟轮询至少 6 s
  const startedAt = Date.now();
  await expect.poll(() => Date.now() - startedAt, { timeout: 15_000, intervals: [250] }).toBeGreaterThan(6_000);
  const transcription = page.waitForResponse((r) => r.url().endsWith("/api/ai/audio/transcriptions"), { timeout: 120_000 });
  await page.getByTestId("chat-mic").click();
  expect((await transcription).status()).toBe(200);
  await expect(page.getByTestId("chat-input")).toHaveValue(/fellow|americans|country|ask/i, { timeout: 60_000 });
  await expect(page.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
  // 听写只填入输入框,不自动发送
  await expect(page.getByTestId("message-user")).toHaveCount(0);
  await expect(page.getByTestId("message-assistant")).toHaveCount(0);
  expect(completionRequests).toEqual([]);
});

test("composer stays visible on a phone-sized screen", async ({ page, request }) => {
  await signIn(page, request);
  await page.getByTestId("nav-chat").click();
  await page.getByTestId("conversation-new").click();
  await page.getByTestId("chat-input").focus();
  const input = await page.getByTestId("chat-input").boundingBox();
  const viewport = page.viewportSize()!;
  expect(input!.y + input!.height).toBeLessThanOrEqual(viewport.height);
  const fontSize = await page.getByTestId("chat-input").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
});
