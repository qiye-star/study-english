import "@testing-library/jest-dom/vitest";
import "~/i18n";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { ALL_OFF, setLinkFlags } from "~/lib/extension-points";

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

// 核心扩展点贡献(= 全部联动关闭的今天;计划 P-L7)。在 beforeEach 里动态导入而不是文件顶部静态导入:
// 这样 vocabulary 的模块在测试文件的 vi.mock(sonner、~/features/chat …)登记之后才求值,不会绑定到未打桩的依赖。
// 每个测试文件只求值一次(模块缓存);联动测试自己导入所需插件。
beforeEach(async () => {
  await import("~/plugins/core");
});

afterEach(() => {
  cleanup();
  setLinkFlags(ALL_OFF);
});
