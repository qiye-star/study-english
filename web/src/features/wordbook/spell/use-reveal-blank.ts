import { useCallback, useEffect, useRef } from "react";

/**
 * 当前空保持在键盘与底部提交栏之上(spec §11.5「保证当前空滚到可见区」,视觉稿 07;review web M2)。
 *
 * - 空本身带 scroll-margin(上让出页头、下让出 sticky 提交栏),所以 `scrollIntoView({block:"nearest"})` 会把它停在栏上方;
 * - 键盘弹起是动画:聚焦那一刻视口还没变矮(useAppHeight 之后才把外壳缩到 visualViewport 高度),所以在
 *   visualViewport 的 resize / scroll 上再滚一次(rAF 合并),只在隐藏输入框聚焦、处于打字阶段时;
 * - 点已经是当前的空不会改 `active`,调用方在 focusBlank 之后显式 `reveal()`。
 *
 * 需要真机确认:iOS Safari / 安卓 Chrome 键盘动画结束后空停在提交栏上方,页头不被推出屏幕。
 */
export function useRevealBlank({ active, enabled, input }: { active: number; enabled: boolean; input: () => HTMLElement | null }) {
  const frame = useRef(0);
  const latest = useRef({ active, enabled, input });
  latest.current = { active, enabled, input };

  const reveal = useCallback(() => {
    if (typeof window === "undefined") return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const { active: i, enabled: on } = latest.current;
      if (!on) return;
      document.querySelector<HTMLElement>(`[data-blank="${i}"]`)?.scrollIntoView?.({ block: "nearest" });
    });
  }, []);

  useEffect(() => {
    if (enabled) reveal();
  }, [active, enabled, reveal]);

  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (!enabled || !vv) return;
    const onViewport = () => {
      const el = latest.current.input();
      if (el && document.activeElement === el) reveal();
    };
    vv.addEventListener("resize", onViewport);
    vv.addEventListener("scroll", onViewport);
    return () => {
      vv.removeEventListener("resize", onViewport);
      vv.removeEventListener("scroll", onViewport);
    };
  }, [enabled, reveal]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return reveal;
}
