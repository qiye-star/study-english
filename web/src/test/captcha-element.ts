import { act } from "@testing-library/react";

/**
 * 页面测试用的假 <altcha-widget>(计划 W4–W7)。真正的 altcha 在 jsdom 里不运行;
 * 测试文件自己 `vi.mock("altcha", ...)`(vi.mock 必须写在测试文件里),这里只提供元素与事件派发。
 */
export const altchaCalls = { reset: 0, verify: 0 };

class FakeAltcha extends HTMLElement {
  configure() {
    /* 隐藏页脚等设置在这里不需要记录 */
  }
  reset() {
    altchaCalls.reset += 1;
  }
  verify() {
    altchaCalls.verify += 1;
    return Promise.resolve(null);
  }
}
if (!customElements.get("altcha-widget")) customElements.define("altcha-widget", FakeAltcha);

/** 每个测试开始前调用:清零计数。 */
export function resetFakeAltcha(): void {
  altchaCalls.reset = 0;
  altchaCalls.verify = 0;
}

export function widgetElement(): HTMLElement | null {
  return document.querySelector("altcha-widget");
}

/** 模拟组件求解完成:派发 verified 事件(与真实组件一致,detail.payload)。 */
export function solveCaptcha(payload: string): void {
  const el = widgetElement();
  if (!el) throw new Error("altcha-widget is not mounted");
  act(() => {
    el.dispatchEvent(new CustomEvent("verified", { detail: { payload } }));
  });
}
