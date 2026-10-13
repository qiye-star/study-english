import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSoftKeyboard } from "~/features/rooms/assist/use-soft-keyboard";
import { useAppHeight } from "./use-app-height";

/**
 * spec §4.2.4:useAppHeight 的 scrollTo(0,0) 不能让 use-soft-keyboard(监听 vv.scroll)抖动或循环。
 * 真实 window + 手写 visualViewport(EventTarget)+ 手动 rAF 队列。
 */
class FakeVV extends EventTarget {
  height = 800;
  width = 390;
  offsetTop = 0;
  scale = 1;
}

let vv: FakeVV;
let frames: Array<() => void>;
let scrollTo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vv = new FakeVV();
  frames = [];
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { frames.push(() => cb(0)); return frames.length; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => { vv.offsetTop = 0; });
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "visualViewport");
  document.documentElement.style.removeProperty("--app-height");
});

const flush = () => { const run = frames.splice(0); run.forEach((fn) => fn()); };

describe("useAppHeight together with useSoftKeyboard", () => {
  it("one correction per pan, no loop, and the keyboard state does not flap", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      useAppHeight();
      return useSoftKeyboard();
    });

    act(() => { vv.height = 420; vv.offsetTop = 36; vv.dispatchEvent(new Event("resize")); });
    act(() => { vv.dispatchEvent(new Event("scroll")); flush(); });
    const keyboard = result.current;
    const settledRenders = renders;
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    // scrollTo 自己引起的 scroll 事件:不再复位,软键盘状态不变,不再重渲染
    act(() => { vv.dispatchEvent(new Event("scroll")); flush(); });
    act(() => { vv.dispatchEvent(new Event("scroll")); flush(); });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(keyboard);
    expect(renders).toBe(settledRenders);
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("420px");
  });
});
