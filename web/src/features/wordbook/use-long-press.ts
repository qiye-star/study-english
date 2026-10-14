import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { LONG_PRESS_MS, createLongPress } from "./long-press";

export interface LongPressProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  onClickCapture: (e: MouseEvent<HTMLElement>) => void;
  onContextMenu: (e: MouseEvent<HTMLElement>) => void;
}

/**
 * 长按(计划 2026-10-14-review-bilingual-longpress R-L2–R-L4):返回 `(id) => props`,把 props 展开到要长按的元素上。
 * 按住 `ms`(默认 450)不动 → `onLongPress(元素)`;移动 > 8 px、pointercancel、文档滚动(捕获)、提前松手 → 取消;
 * 触发后松手紧跟的一个 click 在捕获阶段被吞掉;contextmenu 一律 preventDefault(Android 不弹系统选词 / 菜单)。
 * 只认主指针、主键。触控与鼠标都走 Pointer Events。不记日志。
 */
export function useLongPress(
  onLongPress: (el: HTMLElement) => void,
  { ms = LONG_PRESS_MS, now = () => performance.now() }: { ms?: number; now?: () => number } = {},
): (id: string) => LongPressProps {
  const latest = useRef(onLongPress);
  useEffect(() => {
    latest.current = onLongPress;
  });
  const [api] = useState(() => {
    const lp = createLongPress();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let target: HTMLElement | null = null;
    let pointerId: number | null = null;
    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      document.removeEventListener("scroll", onScroll, true);
    };
    const abort = () => {
      lp.cancel();
      clear();
      pointerId = null;
      target = null;
    };
    function onScroll() {
      abort();
    }
    const mine = (e: { pointerId: number }) => pointerId === null || e.pointerId === pointerId;
    const props = (id: string): LongPressProps => ({
      onPointerDown: (e) => {
        if (e.button > 0 || e.isPrimary === false) return;
        abort();
        pointerId = e.pointerId;
        target = e.currentTarget;
        lp.down(id, e.clientX ?? 0, e.clientY ?? 0);
        document.addEventListener("scroll", onScroll, true);
        timer = setTimeout(() => {
          timer = null;
          document.removeEventListener("scroll", onScroll, true);
          if (lp.fire() !== null && target) latest.current(target);
        }, ms);
      },
      onPointerMove: (e) => {
        if (mine(e) && lp.move(e.clientX ?? 0, e.clientY ?? 0)) clear();
      },
      onPointerUp: (e) => {
        if (!mine(e)) return;
        lp.up(now());
        clear();
        pointerId = null;
        target = null;
      },
      onPointerCancel: (e) => {
        if (mine(e)) abort();
      },
      onClickCapture: (e) => {
        if (!lp.swallowClick(now())) return;
        e.preventDefault();
        e.stopPropagation();
      },
      onContextMenu: (e) => e.preventDefault(),
    });
    return { props, abort };
  });
  useEffect(() => () => api.abort(), [api]);
  return api.props;
}
