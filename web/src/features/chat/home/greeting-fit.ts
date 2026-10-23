import { useLayoutEffect, type RefObject } from "react";

export const FIT_STEP = 0.05;
export const FIT_MIN = 0.72;

/** 内容放不下时的缩放系数:从 1 起每次减 0.05,下限 0.72;`need(scale)` 返回该缩放下内容所需高度。 */
export function fitScale(avail: number, need: (scale: number) => number): number {
  let s = 1;
  while (s > FIT_MIN && need(s) > avail) s = Math.max(FIT_MIN, Math.round((s - FIT_STEP) * 100) / 100);
  return s;
}

/**
 * 演示页 fitGreeting:整体按 --gs 缩小问候字号。只读布局尺寸(offsetHeight 不受动画 transform 影响);
 * `box` 是放行文字的容器,`fg` 是前景(它的内边距之外的高度就是可用高度)。
 */
export function useFitGreeting(fg: RefObject<HTMLElement>, box: RefObject<HTMLElement>, parts: Array<RefObject<HTMLElement>>, deps: unknown[]) {
  useLayoutEffect(() => {
    const root = fg.current;
    const lines = box.current;
    if (!root || !lines) return;
    const fit = () => {
      const cs = getComputedStyle(root);
      const avail = root.clientHeight - parseFloat(cs.paddingTop || "0") - parseFloat(cs.paddingBottom || "0");
      const scale = fitScale(avail, (s) => {
        lines.style.setProperty("--gs", String(s));
        return parts.reduce((sum, p) => sum + (p.current?.offsetHeight ?? 0), 0) + lines.offsetHeight;
      });
      lines.style.setProperty("--gs", String(scale));
    };
    fit();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    ro?.observe(root);
    return () => ro?.disconnect();
  }, deps);
}
