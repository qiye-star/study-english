import "@testing-library/jest-dom/vitest";
import "~/i18n";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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

afterEach(() => cleanup());
