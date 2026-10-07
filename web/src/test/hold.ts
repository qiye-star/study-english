import { fireEvent, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

// jsdom 若没有 PointerEvent,用 MouseEvent 补一个(只用于测试)
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
}

/** 按住麦克风 ms 毫秒(默认 1000),可先上滑 dy(负数)到 x 处再松手。时钟用 performance.now 的模拟值,不真等。 */
export async function holdMic(el: HTMLElement, opts: { ms?: number; dy?: number; x?: number } = {}): Promise<void> {
  let t = 10_000;
  const now = vi.spyOn(performance, "now").mockImplementation(() => t);
  try {
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 700, button: 0 });
    await waitFor(() => expect(el).toHaveAttribute("data-hold", "recording"));
    t += opts.ms ?? 1000;
    const x = opts.x ?? 200;
    const y = 700 + (opts.dy ?? 0);
    if (opts.dy) fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y });
  } finally {
    now.mockRestore();
  }
}

export function pressKey(el: HTMLElement, key: " " | "Enter" | "Escape" = " "): void {
  fireEvent.keyDown(el, { key });
  fireEvent.keyUp(el, { key });
}
