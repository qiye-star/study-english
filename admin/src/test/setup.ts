import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

// jsdom 没实现媒体播放与 object URL
Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
// jsdom 没有 canvas 实现;波形组件对 null 上下文会安静地跳过绘制
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });
if (!URL.createObjectURL) URL.createObjectURL = () => "blob:mock";
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
