import { useEffect } from "react";

/** iOS 键盘收起动画约 250–300 ms;focusout 之后在这之后再复位一次(R-K7,经验值,未真机验证)。 */
export const KEYBOARD_SETTLE_MS = 350;

/**
 * iOS 键盘弹出时 visualViewport 变矮;把它写进 --app-height,让输入栏始终可见。
 *
 * 另外:iOS Safari 在输入框聚焦时会把视觉视口相对布局视口平移(visualViewport.offsetTop > 0,有时 scrollY > 0),
 * 而外壳贴在布局视口顶端,平移后页面错位 / 「跳到顶部」(计划 2026-10-13-ios-keyboard-scroll,假设 H1,未真机验证)。
 * visualViewport 的 resize / scroll、window 的 resize、focusin / focusout 之后排一个 rAF(合并),
 * 帧内才读偏移;非 0 就 scrollTo(0, 0)。复位后偏移为 0,不会循环。双指放大(scale > 1.01)时不动用户的平移。
 */
export function useAppHeight(win: Window = window): void {
  useEffect(() => {
    const viewport = win.visualViewport;
    const doc = win.document;
    let frame = 0;
    let timer = 0;

    const apply = () => {
      const height = Math.round(viewport ? viewport.height : win.innerHeight);
      doc.documentElement.style.setProperty("--app-height", `${height}px`);
    };

    const settle = () => {
      frame = 0;
      if (viewport && viewport.scale > 1.01) return;
      if (win.scrollY !== 0 || (viewport?.offsetTop ?? 0) > 0) win.scrollTo(0, 0);
    };
    const schedule = () => {
      if (frame === 0) frame = win.requestAnimationFrame(settle);
    };

    const onViewport = () => {
      apply();
      schedule();
    };
    const onFocusIn = () => {
      win.clearTimeout(timer);
      timer = 0;
      schedule();
    };
    const onFocusOut = () => {
      schedule();
      win.clearTimeout(timer);
      timer = win.setTimeout(() => {
        timer = 0;
        schedule();
      }, KEYBOARD_SETTLE_MS);
    };

    apply();
    viewport?.addEventListener("resize", onViewport);
    viewport?.addEventListener("scroll", schedule);
    win.addEventListener("resize", onViewport);
    doc.addEventListener("focusin", onFocusIn);
    doc.addEventListener("focusout", onFocusOut);
    return () => {
      viewport?.removeEventListener("resize", onViewport);
      viewport?.removeEventListener("scroll", schedule);
      win.removeEventListener("resize", onViewport);
      doc.removeEventListener("focusin", onFocusIn);
      doc.removeEventListener("focusout", onFocusOut);
      if (frame !== 0) win.cancelAnimationFrame(frame);
      win.clearTimeout(timer);
    };
  }, [win]);
}
