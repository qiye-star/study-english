import { useEffect, useRef } from "react";
import { lookupPressContext } from "~/lib/lookup-context";
import { LONG_PRESS_MS, createLongPress } from "~/lib/long-press";
import { selectWordAt } from "~/lib/select-word";

const perfNow = () => performance.now();

export interface LongPressLookupOptions {
  /** false while the lookup drawer is open */
  enabled: boolean;
  /** called once the pressed word is selected (or the browser's own selection is kept): read the selection now */
  onSelect: () => void;
  doc?: Document;
  ms?: number;
  /** clock for the click-swallow window (tests inject one) */
  now?: () => number;
}

/**
 * 全站长按查词(计划 2026-10-15-global-longpress-glass-lookup R-L2–R-L8):文档级捕获监听,只认触摸主指针。
 * 按在 [data-lookup-context] 里(不在其中的链接 / 按钮上,不在 data-lookup-press="own" 里)450 ms 且移动 ≤ 8 px →
 * 已有原生选区就保留它,否则选中手指下的英文单词(selectWordAt,限定在这个上下文里)→ onSelect()(LookupLayer 立刻读选区)。
 * 滚动、移动 > 8 px、提前松手、第二根手指 → 取消;没移动的 pointercancel 不取消(安卓接管长按时会发)。
 * 触发后松手 400 ms 内、落在被按文字里的第一个 click 在捕获阶段吞掉。从不 preventDefault pointerdown / touchstart / contextmenu,
 * 不改 user-select / touch-action,不清选区(R-L4、R-L8)。不记日志。
 */
export function useLongPressLookup({ enabled, onSelect, doc = document, ms = LONG_PRESS_MS, now = perfNow }: LongPressLookupOptions): void {
  const latest = useRef(onSelect);
  useEffect(() => {
    latest.current = onSelect;
  });
  useEffect(() => {
    if (!enabled) return;
    const lp = createLongPress();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pointerId: number | null = null;
    let at = { x: 0, y: 0 };
    let ctx: Element | null = null;
    let firedCtx: Element | null = null;
    let moved = false;
    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const abort = () => {
      lp.cancel();
      clear();
      pointerId = null;
      ctx = null;
    };
    const fire = () => {
      timer = null;
      if (lp.fire() === null || !ctx) return;
      firedCtx = ctx;
      const sel = doc.getSelection();
      const native = !!sel && !sel.isCollapsed && sel.toString().trim() !== "";
      if (native || selectWordAt(at.x, at.y, doc, ctx)) latest.current();
    };
    const mine = (e: PointerEvent) => pointerId !== null && e.pointerId === pointerId;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      abort();
      if (!e.isPrimary) return; // 第二根手指:是捏合,不是长按
      const found = lookupPressContext(e.target);
      if (!found) return;
      ctx = found;
      firedCtx = null;
      pointerId = e.pointerId;
      at = { x: e.clientX, y: e.clientY };
      moved = false;
      lp.down(String(e.pointerId), e.clientX, e.clientY);
      timer = setTimeout(fire, ms);
    };
    const onMove = (e: PointerEvent) => {
      if (mine(e) && lp.move(e.clientX, e.clientY)) {
        moved = true;
        clear();
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!mine(e)) return;
      lp.up(now());
      clear();
      pointerId = null;
    };
    const onCancel = (e: PointerEvent) => {
      if (!mine(e)) return;
      if (moved || !lp.pressing()) abort(); // 没移动:浏览器接管了长按,计时器照走(R-L3)
    };
    const onScroll = () => {
      if (lp.pressing()) abort();
    };
    const onClick = (e: MouseEvent) => {
      const inside = firedCtx !== null && e.target instanceof Node && firedCtx.contains(e.target);
      if (!inside || !lp.swallowClick(now())) return;
      e.preventDefault();
      e.stopPropagation();
    };
    doc.addEventListener("pointerdown", onDown, true);
    doc.addEventListener("pointermove", onMove, true);
    doc.addEventListener("pointerup", onUp, true);
    doc.addEventListener("pointercancel", onCancel, true);
    doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
    doc.addEventListener("click", onClick, true);
    return () => {
      doc.removeEventListener("pointerdown", onDown, true);
      doc.removeEventListener("pointermove", onMove, true);
      doc.removeEventListener("pointerup", onUp, true);
      doc.removeEventListener("pointercancel", onCancel, true);
      doc.removeEventListener("scroll", onScroll, { capture: true });
      doc.removeEventListener("click", onClick, true);
      abort();
    };
  }, [enabled, doc, ms, now]);
}
