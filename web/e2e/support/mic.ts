import { expect, type Page } from "@playwright/test";

/** 兼容两种麦克风按钮:旧的"点一下开始、再点一下停止",新的"按住说话"(data-hold-to-talk)。 */
export async function recordFor(page: Page, ms: number): Promise<void> {
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
