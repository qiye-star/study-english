import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { registerViaApi, signIn } from "./support/auth";
import { headerOption } from "./support/header";
import { SPEECH_WAV, useFakeMicrophone } from "./support/fake-mic";
import { composerMode, recordByKeyboard } from "./support/mic";

// 阶段 0 结论(docs/superpowers/plans/2026-10-04-mobile-web-spike-results.md 第 B 节):
// Playwright 的 WebKit 构建没有 MediaRecorder,语音输入只能在 Chromium 上运行。
const WEBKIT_NO_RECORDER = "Playwright WebKit has no MediaRecorder (see 2026-10-04-mobile-web-spike-results.md, section B)";

// 真实转写依赖 Volcengine ARK 账户;账户欠费期间不可用。只有显式设置 E2E_REAL_STT=1 才运行语音消息用例。
const STT_SKIP_REASON = "real STT unavailable (set E2E_REAL_STT=1 once the Ark account is funded)";
const REAL_STT = process.env.E2E_REAL_STT === "1";

/** 预检:带令牌 POST 假 WAV 到转写接口;E2E_REAL_STT=1 时上游不可用(502/503)直接失败,而不是跳过。 */
async function assertRealSttAvailable(request: APIRequestContext): Promise<void> {
  const { token } = await registerViaApi(request);
  const r = await request.post("/api/ai/audio/transcriptions", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { file: { name: "jfk.wav", mimeType: "audio/wav", buffer: readFileSync(SPEECH_WAV) }, model: "whisper-1" },
    timeout: 150_000,
  });
  if (r.status() === 502 || r.status() === 503) {
    throw new Error(`E2E_REAL_STT=1 but the transcription upstream is unavailable (HTTP ${r.status()}): fund the Ark account or unset E2E_REAL_STT`);
  }
  expect(r.status(), await r.text()).toBe(200);
}

/** 在约 1.5 秒的稳定窗口内,连续轮询计数都等于期望值(防止缓存命中断言在迟到请求前就通过)。 */
async function expectStableCount(read: () => number, expected: number): Promise<void> {
  const deadline = Date.now() + 1_500;
  await expect
    .poll(async () => {
      await new Promise((r) => setTimeout(r, 250));
      return read() !== expected ? read() : Date.now() >= deadline ? expected : -1;
    }, { timeout: 5_000, intervals: [0] })
    .toBe(expected);
}

async function newConversation(page: Page): Promise<string> {
  await page.getByTestId("nav-chat").click();
  await page.getByTestId("conversation-new").click();
  await page.getByTestId("scenario-free").click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

async function sendText(page: Page, text: string): Promise<void> {
  const count = await page.getByTestId("message-assistant").count();
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("message-assistant")).toHaveCount(count + 1);
  await expect(page.getByTestId("message-assistant").last()).toHaveAttribute("data-status", "done", { timeout: 90_000 });
}

async function authedStatus(page: Page, path: string): Promise<number> {
  return page.evaluate(async (p) => {
    const token = JSON.parse(localStorage.getItem("enjoy-web.auth")!).token;
    return (await fetch(p, { headers: { Authorization: `Bearer ${token}` } })).status;
  }, path);
}

async function newScenario(page: Page, id: string): Promise<string> {
  await page.getByTestId("nav-chat").click();
  await page.getByTestId("conversation-new").click();
  await page.getByTestId(`scenario-${id}`).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

/** 记录所有朗读按钮 data-state 的变化(元素可能稍后才出现,所以观察整个 body)。 */
async function recordTtsStates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __tts: string[] };
    w.__tts = [];
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as HTMLElement;
        if (el.dataset?.testid === "message-tts") w.__tts.push(el.getAttribute("data-state") ?? "");
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
  });
}

/** R25:Chromium 带自动播放参数,应进入 playing;WebKit 可能被拦截而出现"点此朗读"。返回实际出现的那一种。 */
async function autoReadOutcome(page: Page): Promise<string> {
  let outcome = "";
  await expect.poll(async () => {
    const states = await page.evaluate(() => (window as unknown as { __tts: string[] }).__tts);
    outcome = states.includes("playing") ? "playing" : (await page.getByTestId("autospeak-blocked").count()) ? "blocked" : "";
    return outcome;
  }, { timeout: 60_000 }).not.toBe("");
  return outcome;
}

test("chat: stream, persist, read aloud and delete", async ({ page, request, browserName }) => {
  await useFakeMicrophone(page, browserName);
  await signIn(page, request);
  await page.getByTestId("nav-chat").click();
  await page.getByTestId("conversation-new").click();
  await page.getByTestId("scenario-free").click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  // R27:关掉自动朗读,本用例验证的是手动朗读的状态机(自动朗读见下方新用例)
  await (await headerOption(page, "conversation-autospeak")).click();
  await expect(await headerOption(page, "conversation-autospeak")).toHaveAttribute("aria-pressed", "false");
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

test("composer stays visible on a phone-sized screen", async ({ page, request }) => {
  await signIn(page, request);
  await page.getByTestId("nav-chat").click();
  await page.getByTestId("conversation-new").click();
  await page.getByTestId("scenario-free").click();
  await page.getByTestId("chat-input").focus();
  const input = await page.getByTestId("chat-input").boundingBox();
  const viewport = page.viewportSize()!;
  expect(input!.y + input!.height).toBeLessThanOrEqual(viewport.height);
  const fontSize = await page.getByTestId("chat-input").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
});

test("voice message: transcript, streamed reply, pronunciation and grammar badges, replay, practice and cascade delete", async ({ page, request, browserName }) => {
  test.skip(browserName === "webkit", WEBKIT_NO_RECORDER);
  test.skip(!REAL_STT, STT_SKIP_REASON);
  test.setTimeout(420_000); // 预检(最长 150s)+ 转写/评测/语法(各最长 150s)+ 回放与级联删除
  await assertRealSttAvailable(request);
  await useFakeMicrophone(page, browserName);
  await signIn(page, request);
  const conversationId = await newConversation(page);
  const transcription = page.waitForResponse((r) => r.url().endsWith("/api/ai/audio/transcriptions"), { timeout: 120_000 });
  const assessed = page.waitForResponse((r) => r.url().endsWith("/api/speech/assessments") && r.request().method() === "POST", { timeout: 150_000 });
  const grammar = page.waitForResponse((r) => r.url().endsWith("/api/ai/grammar"), { timeout: 150_000 });

  // 输入栏默认是文字模式:先切到"按住 说话"长条
  await composerMode(page, "voice");
  // R29:按住说话没有固定时长;用键盘后备(Space 开始/Space 结束)保留"计时器到 7 秒"的断言
  await recordByKeyboard(page, async () => {
    // 素材开头即 "And so, my fellow Americans, ask not ...";以计时器为准录满 7 秒以上
    await expect(page.getByTestId("voice-timer")).toHaveText(/^00:(0[7-9]|[1-5]\d) \//, { timeout: 30_000 });
  });
  expect((await transcription).status()).toBe(200);
  const user = page.getByTestId("message-user").last();
  await expect(user).toHaveAttribute("data-voice", "sent", { timeout: 60_000 });
  await expect(user).toContainText(/fellow|americans|country|ask/i);
  const autoRead = page.waitForResponse((r) => r.url().endsWith("/api/ai/audio/speech"), { timeout: 90_000 });
  await expect(page.getByTestId("message-assistant").last()).toHaveAttribute("data-status", "done", { timeout: 90_000 });
  expect((await autoRead).status()).toBe(200); // 语音消息的回复同样自动朗读(结束录音那一下解锁)

  const assessment = await assessed;
  expect(assessment.status()).toBe(200);
  const assessmentId = (await assessment.json()).assessment_id as string;
  expect(assessmentId).toBeTruthy();
  expect((await grammar).status()).toBe(200);
  await expect(page.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(page.getByTestId("badge-grammar")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  console.log(`voice: score=${await page.getByTestId("badge-pronunciation").getAttribute("data-score")} grammarErrors=${await page.getByTestId("badge-grammar").getAttribute("data-errors")}`);

  // 结果已随消息保存或经 PATCH 补写到服务端
  await expect.poll(() => page.evaluate(async (id) => {
    const token = JSON.parse(localStorage.getItem("enjoy-web.auth")!).token;
    const r = await fetch(`/api/conversations/${id}/messages`, { headers: { Authorization: `Bearer ${token}` } });
    const saved = (await r.json()).messages.find((m: { role: string }) => m.role === "user");
    return [saved?.assessment_id ?? null, !!saved?.grammar];
  }, conversationId), { timeout: 60_000 }).toEqual([assessmentId, true]);
  await page.reload();
  await expect(page.getByTestId("badge-pronunciation")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("message-user").last()).toHaveAttribute("data-voice", "sent");

  // 刷新后回放:应用带令牌请求录音 → blob URL
  const audio = page.waitForResponse((r) => r.url().endsWith(`/api/assessments/${assessmentId}/audio`), { timeout: 60_000 });
  await page.getByTestId("voice-play").click();
  expect((await audio).status()).toBe(200);
  await expect(page.getByTestId("voice-play")).not.toHaveAttribute("data-state", "error");

  // 详情 → 跟读这句:带参考文本跳转
  await page.getByTestId("badge-pronunciation").click();
  await expect(page.getByTestId("turn-detail-assessment").getByTestId("assessment-scores")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("detail-practice").click();
  await expect(page).toHaveURL(/\/practice$/);
  await expect(page.getByTestId("reference-input")).toHaveValue(/fellow|americans|country|ask/i);

  // 删除对话:对话评测与录音一并删除(文件是否删除在门槛 5 里用 docker exec 复核)
  await page.getByTestId("nav-chat").click();
  await page.getByTestId("conversation-delete").first().click();
  await page.getByTestId("conversation-delete-confirm").click();
  await expect(page.getByTestId("conversations-empty")).toBeVisible();
  expect(await authedStatus(page, `/api/assessments/${assessmentId}`)).toBe(404);
  expect(await authedStatus(page, `/api/assessments/${assessmentId}/audio`)).toBe(404);
  console.log(`voice: deleted assessment ${assessmentId}`);
});

test("grammar: a correct and a wrong typed message; the corrected sentence goes to practice", async ({ page, request }) => {
  await signIn(page, request);
  await newConversation(page);
  await sendText(page, "I went to the park yesterday and bought two apples.");
  const clean = page.getByTestId("badge-grammar").last();
  await expect(clean).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(clean).toHaveAttribute("data-errors", "0");
  await sendText(page, "Yesterday I go to the park and buy two apple.");
  await expect(page.getByTestId("badge-grammar")).toHaveCount(2, { timeout: 60_000 });
  const wrong = page.getByTestId("badge-grammar").last();
  await expect(wrong).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(wrong).toHaveAttribute("data-errors", /^[1-9]\d*$/);
  await wrong.click();
  const corrected = (await page.getByTestId("grammar-corrected").innerText()).trim();
  expect(corrected).not.toBe("Yesterday I go to the park and buy two apple.");
  console.log(`grammar: corrected=${corrected}`);
  await page.getByTestId("grammar-practice").click();
  await expect(page).toHaveURL(/\/practice$/);
  await expect(page.getByTestId("reference-input")).toHaveValue(corrected);
});

test("translation on demand is cached when toggled; bilingual mode translates new replies", async ({ page, request }) => {
  await signIn(page, request);
  await page.getByTestId("nav-me").click();
  await page.getByTestId("me-language").selectOption("zh-CN"); // R24
  await newConversation(page);
  let completions = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ai/chat/completions")) completions++;
  });
  await sendText(page, "Tell me one short fact about the moon.");
  const afterReply = completions;
  await page.getByTestId("message-translate").last().click();
  const translation = page.getByTestId("message-translation").last();
  await expect(translation).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(translation).toContainText(/[一-鿿]/);
  await expectStableCount(() => completions, afterReply + 1);
  await page.getByTestId("message-translate").last().click();
  await expect(page.getByTestId("message-translation")).toHaveCount(0);
  await page.getByTestId("message-translate").last().click();
  await expect(page.getByTestId("message-translation").last()).toHaveAttribute("data-status", "done");
  await expectStableCount(() => completions, afterReply + 1); // 收起再展开不再请求(稳定窗口内计数不变)

  await (await headerOption(page, "conversation-bilingual")).click();
  await expect(await headerOption(page, "conversation-bilingual")).toHaveAttribute("aria-pressed", "true");
  await sendText(page, "And one about the sun?");
  await expect(page.getByTestId("message-translation")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId("message-translation").last()).toContainText(/[一-鿿]/, { timeout: 60_000 });
});

test("save a reply sentence, find it in the practice list and practice it", async ({ page, request }) => {
  await signIn(page, request);
  await newConversation(page);
  await sendText(page, "Say hello to me in one short sentence.");
  await page.getByTestId("message-practice").last().click();
  const first = page.getByTestId("practice-sentence").first();
  const sentence = (await first.innerText()).trim();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/practice-items") && r.request().method() === "POST");
  await first.getByTestId("practice-sentence-save").click();
  expect((await saved).status()).toBe(200);
  await page.keyboard.press("Escape");
  await page.getByTestId("nav-practice").click();
  await page.getByTestId("practice-list").click();
  await expect(page.getByTestId("practice-item")).toHaveCount(1);
  await expect(page.getByTestId("practice-item")).toContainText(sentence);
  await page.getByTestId("practice-item").click();
  await expect(page).toHaveURL(/\/practice$/);
  await expect(page.getByTestId("reference-input")).toHaveValue(sentence);
});

test("scenario: the opening line is saved and read aloud, replies are read aloud, the switch turns it off", async ({ page, request, browserName }) => {
  await signIn(page, request);
  await page.getByTestId("nav-chat").click();
  await recordTtsStates(page);
  let speech = 0;
  page.on("response", (r) => { if (r.url().endsWith("/api/ai/audio/speech") && r.status() === 200) speech++; });
  const openingSpeech = page.waitForResponse((r) => r.url().endsWith("/api/ai/audio/speech"), { timeout: 60_000 });
  const id = await newScenario(page, "cafe");
  await expect(page.getByTestId("message-assistant").first()).toContainText("What can I get started for you today?");
  await expect(page.getByTestId("conversation-scenario")).toContainText("Ordering coffee");
  expect((await openingSpeech).status()).toBe(200);
  const outcome = await autoReadOutcome(page);
  console.log(`scenario opening auto-read (${browserName}): ${outcome}`);
  if (browserName === "chromium") expect(outcome).toBe("playing");

  // 服务端:第一条是助手开场白;配置只有场景与难度,没有固化模型/音色(R2)
  const stored = await page.evaluate(async (cid) => {
    const token = JSON.parse(localStorage.getItem("enjoy-web.auth")!).token;
    const headers = { Authorization: `Bearer ${token}` };
    const messages = (await (await fetch(`/api/conversations/${cid}/messages`, { headers })).json()).messages;
    const config = (await (await fetch(`/api/conversations/${cid}`, { headers })).json()).config;
    return { first: messages[0], config };
  }, id);
  expect(stored.first.role).toBe("assistant");
  expect(stored.config).toEqual({ scenario: { id: "cafe" }, level: "auto" });

  const beforeReply = speech;
  await sendText(page, "A small latte, please.");
  await expect.poll(() => speech, { timeout: 60_000 }).toBeGreaterThan(beforeReply);
  console.log(`scenario reply: ${(await page.getByTestId("message-assistant").last().innerText()).trim()}`);

  await (await headerOption(page, "conversation-autospeak")).click();
  await expect(await headerOption(page, "conversation-autospeak")).toHaveAttribute("aria-pressed", "false");
  const afterOff = speech;
  await sendText(page, "And a croissant, too.");
  await expectStableCount(() => speech, afterOff);
});

test("hints: three suggested replies, one fills the composer", async ({ page, request }) => {
  await signIn(page, request);
  await newConversation(page);
  await sendText(page, "I want to practice ordering food in a restaurant.");
  const hints = page.waitForResponse((r) => r.url().endsWith("/api/ai/chat/completions") && (r.request().postData() ?? "").includes("response_format"), { timeout: 90_000 });
  await page.getByTestId("chat-hints").click();
  expect((await hints).status()).toBe(200);
  const result = page.getByTestId("hints-result");
  await expect(result).not.toHaveAttribute("data-status", "loading", { timeout: 60_000 });
  if ((await result.getAttribute("data-status")) === "error") {
    console.log("hints: first answer was malformed, retrying once");
    await page.getByTestId("hints-retry").click();
  }
  await expect(result).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(page.getByTestId("hint-item")).toHaveCount(3);
  const first = (await page.getByTestId("hint-item").first().locator("p").first().innerText()).trim();
  console.log(`hints: ${first}`);
  await page.getByTestId("hint-fill").first().click();
  await expect(page.getByTestId("chat-input")).toHaveValue(first);
});

test("recap: facts from the conversation and a stored Chinese summary", async ({ page, request }) => {
  await signIn(page, request);
  const id = await newConversation(page);
  await sendText(page, "Yesterday I go to the park with my friend.");
  await expect(page.getByTestId("badge-grammar").last()).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await sendText(page, "We plays football for two hours.");
  await expect(page.getByTestId("badge-grammar").last()).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await (await headerOption(page, "conversation-recap")).click();
  await expect(page.getByTestId("recap-user-messages")).toHaveText("2");
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/conversations/${id}`) && r.request().method() === "PATCH"
    && (r.request().postData() ?? "").includes("\"recap\""), { timeout: 120_000 });
  await page.getByTestId("recap-generate").click();
  await expect(page.getByTestId("recap-summary")).toHaveAttribute("data-status", "done", { timeout: 90_000 });
  await expect(page.getByTestId("recap-summary")).toContainText(/[一-鿿]/);
  expect((await saved).status()).toBe(200);
  console.log(`recap: grammar categories=${await page.getByTestId("recap-grammar-category").count()} expressions=${await page.getByTestId("recap-expression").count()}`);

  await page.reload();
  let completions = 0;
  page.on("request", (r) => { if (r.url().endsWith("/api/ai/chat/completions")) completions++; });
  await (await headerOption(page, "conversation-recap")).click();
  await expect(page.getByTestId("recap-summary")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("recap-stale")).toHaveCount(0);
  expect(completions).toBe(0);
});
