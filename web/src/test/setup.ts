import "@testing-library/jest-dom/vitest";
import "~/i18n";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { ALL_OFF, setLinkFlags, slotRendererLoaded } from "~/lib/extension-points";

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): unknown[] {
    return [];
  }
}
// jsdom 没有这些 API;enjoy 的 ScrollArea、WavesurferPlayer 与 web 的主题代码会用到。
globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null as null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// 核心扩展点贡献(= 全部联动关闭的今天;计划 P-L7),只给能渲染插槽的测试文件(其依赖图里有
// lib/extension-points-react)加载:纯逻辑的测试文件不必在钩子里冷编译 vocabulary 按钮、lucide 图标与 enjoy 的
// Button —— 全量并行时那一次编译曾超过 10 秒钩子超时(Z1)。动态导入而不是文件顶部静态导入:vocabulary 的模块要在
// 测试文件的 vi.mock(sonner、~/features/chat …)登记之后才求值。beforeAll 时测试文件已求值,标记已就位;beforeEach
// 兜住在用例里才动态导入页面的文件。模块缓存:每个文件只编译一次。超时单独放宽,因为这里只有冷编译,不会挂起。
const CORE_IMPORT_TIMEOUT = 60_000;
const loadCore = async () => {
  if (slotRendererLoaded()) await import("~/plugins/core");
};
beforeAll(loadCore, CORE_IMPORT_TIMEOUT);
beforeEach(loadCore, CORE_IMPORT_TIMEOUT);

afterEach(() => {
  cleanup();
  setLinkFlags(ALL_OFF);
});
