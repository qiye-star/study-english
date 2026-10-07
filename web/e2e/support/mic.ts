import { expect, type Page } from "@playwright/test";

/**
 * 仿微信的输入栏:文字输入框与"按住 说话"长条二选一(chat-mode-toggle 切换,本机记住上次的模式)。
 * 切到指定模式;已在该模式(或旧版界面没有切换按钮)时什么都不做。
 */
export async function composerMode(page: Page, mode: "text" | "voice"): Promise<void> {
  const toggle = page.getByTestId("chat-mode-toggle");
  if ((await toggle.count()) === 0) return;
  if ((await toggle.getAttribute("data-mode")) === mode) return;
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-mode", mode);
}

/** 兼容两种麦克风按钮:旧的"点一下开始、再点一下停止",新的"按住说话"(data-hold-to-talk)。 */
export async function recordFor(page: Page, ms: number): Promise<void> {
  await composerMode(page, "voice");
  const mic = page.getByTestId("chat-mic");
  const hold = (await mic.getAttribute("data-hold-to-talk")) !== null;
  if (hold) {
    const box = await mic.boundingBox();
    if (!box) throw new Error("mic button is not visible");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(mic).toHaveAttribute("data-state", "recording");
    await page.waitForTimeout(ms); // 模拟说话时长:这里必须真实等待
    await page.mouse.up();
  } else {
    await mic.click();
    await expect(mic).toHaveAttribute("data-state", "recording");
    await page.waitForTimeout(ms);
    await mic.click();
  }
}

/**
 * 键盘后备录音(Space 开始、再按一次 Space 结束):录音时长由 whileRecording 决定,
 * 用于"等计时器到 7 s"这类不固定时长的用例(R29)。仅适用于按住说话按钮(data-hold-to-talk)。
 */
export async function recordByKeyboard(page: Page, whileRecording: () => Promise<void>): Promise<void> {
  await composerMode(page, "voice");
  const mic = page.getByTestId("chat-mic");
  if ((await mic.getAttribute("data-hold-to-talk")) === null) throw new Error("recordByKeyboard needs the hold-to-talk button");
  await mic.focus();
  await page.keyboard.press("Space");
  await expect(mic).toHaveAttribute("data-state", "recording");
  await whileRecording();
  await page.keyboard.press("Space");
}
