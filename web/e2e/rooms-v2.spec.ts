import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { signIn } from "./support/auth";
import { touchHold } from "./support/touch";

/**
 * Rooms v2(计划 2026-10-10 Task Z1):审批加入、引用、表情回应、正在输入、助手停靠面板不遮挡、邀请链接、语音气泡。
 * 零成本:E2E 栈 ROOMS_AI_GLOBAL_DAILY=0(助手面板只打开、不提问);语音上传用 page.route 返回服务端录制的契约样例
 * (server/tests/fixtures/rooms_v2_voice_contract.json 的 http.upload),真实录音上传、转写与上游不在本用例内(未验证)。
 * 需要服务端:ROOMS_ENABLED=true;助手入口要 rooms_ai_available(配置了 LLM 上游),语音入口要 ROOMS_VOICE_ENABLED + 识别上游。
 */
// e2e/ 是 commonjs(见 web/README.md),用 __dirname
const VOICE = JSON.parse(readFileSync(path.resolve(__dirname, "../../server/tests/fixtures/rooms_v2_voice_contract.json"), "utf8"));

/** 消息只在列表里找:读屏播报区(room-announcer)里也会有同一句 */
const messages = (page: Page) => page.getByTestId("room-messages");
const message = (page: Page, text: string) => messages(page).getByTestId("room-message").filter({ hasText: text });

async function member(browser: Browser, contexts: BrowserContext[], request: Parameters<typeof signIn>[1]) {
  // browser.newContext() 继承配置里的 use(baseURL、设备);自建的上下文不会随测试关闭,finally 里关(同 rooms.spec.ts)
  const context = await browser.newContext({ locale: "zh-CN" });
  contexts.push(context);
  const page = await context.newPage();
  const creds = await signIn(page, request);
  return { page, name: creds.username };
}

test("rooms v2: approval join, quote, reaction, typing, docked assistant, invite link, voice bubble", async ({ browser, request, browserName }) => {
  const contexts: BrowserContext[] = [];
  try {
    const a = await member(browser, contexts, request);
    const b = await member(browser, contexts, request);
    const alice = a.page;
    const bob = b.page;

    // A 建「需房主同意」房间:场景咖啡店、4 人
    await alice.goto("/rooms");
    await alice.getByTestId("room-create").click();
    await alice.getByTestId("room-scenario-cafe").click();
    await alice.getByTestId("room-join-mode").getByRole("radio", { name: "需房主同意" }).click();
    const count = alice.getByTestId("room-max-members");
    for (let i = 0; i < 8 && (await count.innerText()).trim() !== "4"; i++) {
      const n = Number((await count.innerText()).trim());
      await alice.getByTestId(n > 4 ? "room-max-members-dec" : "room-max-members-inc").click();
    }
    await expect(count).toHaveText("4");
    await alice.getByTestId("room-create-submit").click();
    await expect(alice).toHaveURL(/\/rooms\/r\//);
    const code = /(\d{3}) (\d{3})/.exec(await alice.getByTestId("room-code").innerText())!.slice(1).join("");

    // B 用房间号申请 → 等待 → A 在横幅里同意 → B 自动进入
    await bob.goto("/rooms");
    await bob.getByTestId("room-code-input").fill(code);
    await bob.getByTestId("room-join").click();
    await expect(bob.getByTestId("room-join-pending")).toBeVisible();
    const banner = alice.getByTestId("room-join-banner");
    await expect(banner).toContainText(b.name);
    await banner.getByRole("button", { name: "同意" }).first().click();
    await expect(bob).toHaveURL(/\/rooms\/r\//);

    // B 发一句;A 引用回复;B 点 👍
    await bob.getByTestId("room-input").fill("I'd like a latte, please.");
    await bob.getByTestId("room-send").click();
    await message(alice, "I'd like a latte, please.").getByText("I'd like a latte, please.", { exact: true }).click();
    await alice.getByTestId("msg-quote").click();
    await expect(alice.getByTestId("quote-bar")).toBeVisible();
    await alice.getByTestId("room-input").fill("Good choice! Hot or iced?");
    await alice.getByTestId("room-send").click();
    const reply = message(bob, "Good choice! Hot or iced?");
    await expect(reply.getByTestId("quote-block")).toContainText("I'd like a latte");
    await reply.getByText("Good choice! Hot or iced?", { exact: true }).click(); // 不点引用块(它是跳转按钮)
    await bob.getByTestId("react-like").click();
    await expect(messages(alice).getByTestId("reaction-like")).toContainText("1"); // 回应条在气泡下方,不在 room-message 内

    // A 输入时 B 看到「<alice> 正在输入…」
    await alice.getByTestId("room-input").pressSequentially("Let me th", { delay: 30 });
    await expect(bob.getByTestId("room-activity")).toContainText(`${a.name} 正在输入`);
    await alice.getByTestId("room-input").fill("");

    // A 打开助手:停靠面板在输入条之上,不遮挡最后一条消息
    await alice.getByTestId("room-assist-open").click();
    const dock = alice.getByTestId("assist-dock");
    await expect(dock).toBeVisible();
    const lastBottom = await messages(alice).getByTestId("room-message").last()
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const dockTop = await dock.evaluate((el) => el.getBoundingClientRect().top);
    expect(lastBottom).toBeLessThan(dockTop);
    await alice.getByTestId("assist-dock-close").click();

    // A 取邀请链接,C 打开链接直接进入(不经审批)
    await alice.getByTestId("room-invite").click();
    const link = await alice.getByTestId("invite-link").inputValue();
    await alice.keyboard.press("Escape");
    const c = await member(browser, contexts, request);
    await c.page.goto(new URL(link).pathname);
    await c.page.getByTestId("invite-join").click();
    await expect(c.page).toHaveURL(/\/rooms\/r\//);
    await expect(messages(c.page).getByText("Good choice! Hot or iced?")).toBeVisible();

    // 语音:上传接口用契约样例应答,断言气泡出现。CDP 触摸与假麦克风只在 Chromium(WebKit 也没有 MediaRecorder),其他引擎到此为止
    if (browserName !== "chromium") return;
    const upload = VOICE.http.upload;
    const seq = 900_000;
    await alice.route("**/api/rooms/*/voice", (route) => route.request().method() === "POST"
      ? route.fulfill({ json: { seq, message: { ...upload.message, seq, id: "e2e-voice-1", sender: { kind: "user", id: 0, name: a.name } } } })
      : route.fallback());
    await alice.getByTestId("room-voice-toggle").click();
    await touchHold(alice, alice.getByTestId("room-mic"), { ms: 2000 });
    await expect(messages(alice).getByTestId("room-voice")).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
  }
});
