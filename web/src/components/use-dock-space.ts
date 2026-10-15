import { useCallback, useRef } from "react";

/**
 * 底部操作条("dock")占的竖向空间 → CSS 变量 `--dock-space`(写在 <html> 上,px)。
 * 选词操作条(features/lookup/lookup-bar.tsx)读它,把自己抬到 dock 上方,不再压在「继续」之类的按钮上。
 *
 * 口径:dock 上沿 → <main> 内容框下沿(= 悬浮底栏上沿,即 main 的下沿减去它的 padding-bottom = --tab-bar-space)。
 * 所以它等于「dock 自己的高度 + 它贴在内容框下沿的间隙(liquid 皮肤的 mb-2 / bottom-2)」,恰好是 dock 在 --tab-bar-space 之上占的高度。
 * 没有 <main> 祖先时(单元测试、独立挂载)退回 dock 自身的高度。
 * 多个 dock 同时挂载(嵌套 / 叠放)时写最大值;全部卸载后删掉变量(此时 lookup-bar 的 var(--dock-space, 0px) 回到原位置)。
 */
export const DOCK_SPACE_VAR = "--dock-space";

const measured = new Map<HTMLElement, number>();
const observers = new Map<HTMLElement, ResizeObserver>();
let listening = false;

function measure(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const main = el.closest("main");
  if (!main) return Math.max(0, Math.ceil(rect.height));
  const bottom = main.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(main).paddingBottom) || 0);
  return Math.max(0, Math.ceil(bottom - rect.top));
}

function publish() {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  if (measured.size === 0) { root.removeProperty(DOCK_SPACE_VAR); return; }
  root.setProperty(DOCK_SPACE_VAR, `${Math.max(...measured.values())}px`);
}

function remeasureAll() {
  for (const el of measured.keys()) measured.set(el, measure(el));
  publish();
}

function register(el: HTMLElement) {
  measured.set(el, measure(el));
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => { if (measured.has(el)) { measured.set(el, measure(el)); publish(); } });
    ro.observe(el);
    const main = el.closest("main");
    if (main) ro.observe(main);
    observers.set(el, ro);
  }
  if (!listening && typeof window !== "undefined") { window.addEventListener("resize", remeasureAll); listening = true; }
  publish();
}

function unregister(el: HTMLElement) {
  observers.get(el)?.disconnect();
  observers.delete(el);
  measured.delete(el);
  if (measured.size === 0 && listening && typeof window !== "undefined") { window.removeEventListener("resize", remeasureAll); listening = false; }
  publish();
}

/** 返回回调 ref,挂在 dock 元素上;dock 条件渲染时随元素挂载 / 卸载自动登记 / 注销。 */
export function useDockSpace(): (el: HTMLElement | null) => void {
  const current = useRef<HTMLElement | null>(null);
  return useCallback((el: HTMLElement | null) => {
    if (current.current === el) return;
    if (current.current) unregister(current.current);
    current.current = el;
    if (el) register(el);
  }, []);
}
