import type { Locator, Page } from "@playwright/test";

/**
 * 用 CDP `Input.dispatchTouchEvent` 发真实触摸(仅 Chromium):浏览器会据此合成 pointerdown/move/up(pointerType=touch),
 * 与真机手指一致。没用 `page.touchscreen`,因为它只有 tap(没有按住/移动)。
 * 按住 `ms` 毫秒(真实等待),可再把手指移到相对起点 dy 的位置、水平落在绝对坐标 x,然后抬起。
 */
export async function touchHold(page: Page, target: Locator, opts: { ms: number; dy?: number; x?: number }): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("target is not visible");
  const cdp = await page.context().newCDPSession(page);
  try {
    const x0 = box.x + box.width / 2;
    const y0 = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
    await page.waitForTimeout(opts.ms); // 模拟按住时长:必须真实等待
    if (opts.dy !== undefined || opts.x !== undefined) {
      const dy = opts.dy ?? 0;
      const x1 = opts.x ?? x0;
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x0 + (x1 - x0) * (i / steps), y: y0 + dy * (i / steps) }],
        });
      }
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach().catch((): void => undefined);
  }
}
