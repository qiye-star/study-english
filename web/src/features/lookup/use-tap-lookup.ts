import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { isPinnedPath } from "~/lib/glass-flag";
import { lookupTapContext } from "~/lib/lookup-context";
import { selectWordAt, wordRangeAt } from "~/lib/select-word";
import { createPendingMark } from "./pending-mark";
import { IDLE, TAP_MARK_TTL_MS, isTap, stepTap, type Point, type TapEffect, type TapEvent, type TapState } from "./tap-lookup";

const perfNow = () => performance.now();
/** After a lookup selection the browser's own tail events (click) may still collapse it: re-assert it for this long. */
const REASSERT_MS = 500;

export interface TapLookupOptions {
  /** false while the lookup drawer is open */
  enabled: boolean;
  /** called once the tapped word is selected: read the selection now so the bar appears at once */
  onSelect: () => void;
  doc?: Document;
  now?: () => number;
  ttlMs?: number;
}

/**
 * Tap to mark, tap again to look up (replaces the long-press recogniser; docs/superpowers/plans/2026-10-15-tap-lookup-results.md).
 * Document-level passive pointer listeners, touch and pen only (the desktop mouse keeps native select / double-click).
 * A tap (moved <= 8 px, held <= 450 ms, single finger, no selection present) on a word of a `[data-lookup-context]` text
 * outside interactive elements, `data-lookup-tap="off"` subtrees and pinned routes (library, changelog) underlines that word
 * (`PendingMark`); a second tap on the same word selects it (`selectWordAt`) and calls `onSelect()`, which shows the lookup bar.
 * Another word moves the underline; tapping elsewhere, any scroll (capture), a resize, a route change, a non-empty selection
 * or 6 s clear it. Never preventDefault, never changes user-select / touch-action, never logs. Needs a Router (route changes).
 */
export function useTapLookup({ enabled, onSelect, doc = document, now = perfNow, ttlMs = TAP_MARK_TTL_MS }: TapLookupOptions): void {
  const { pathname } = useLocation();
  const latest = useRef(onSelect);
  const clock = useRef(now);
  const path = useRef(pathname);
  const clearMarker = useRef<(() => void) | null>(null);
  useEffect(() => {
    latest.current = onSelect;
    clock.current = now;
    path.current = pathname;
  });
  // route change: drop the marker
  useEffect(() => clearMarker.current?.(), [pathname]);
  useEffect(() => {
    if (!enabled) return;
    const mark = createPendingMark(doc);
    const ids = new WeakMap<Node, number>();
    let nextId = 1;
    const keyOf = (range: Range): string => {
      const node = range.startContainer;
      let id = ids.get(node);
      if (id === undefined) { id = nextId; nextId += 1; ids.set(node, id); }
      return `${id}:${range.startOffset}`;
    };
    let state: TapState = IDLE;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pointerId: number | null = null;
    let down: (Point & { t: number }) | null = null;
    const active = new Set<number>();
    let reassert: { off: () => void } | null = null;
    const stopTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const stopReassert = () => {
      reassert?.off();
      reassert = null;
    };
    const apply = (effect: TapEffect, range?: Range, ctx?: Element, at?: Point) => {
      if (effect.kind !== "none") stopTimer(); // a "none" keeps the countdown of an unchanged marker
      if (effect.kind === "mark" && range) {
        mark.show(range);
        timer = setTimeout(() => feed({ type: "tick", time: clock.current() }), ttlMs);
      } else if (effect.kind === "lookup" && ctx && at) {
        mark.clear();
        stopReassert();
        if (selectWordAt(at.x, at.y, doc, ctx)) {
          const sel = doc.getSelection();
          const picked = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
          latest.current();
          if (picked) {
            // Android: the compat click after pointerup can collapse a selection set during the tap; put it back once
            const onClick = () => {
              const s = doc.getSelection();
              if (s && s.isCollapsed) {
                s.removeAllRanges();
                s.addRange(picked);
                latest.current();
              }
              stopReassert();
            };
            const off = () => { clearTimeout(t); doc.removeEventListener("click", onClick, true); };
            const t = setTimeout(stopReassert, REASSERT_MS);
            doc.addEventListener("click", onClick, true);
            reassert = { off };
          }
        }
      } else if (effect.kind === "clear") {
        mark.clear();
      }
    };
    function feed(event: TapEvent, range?: Range, ctx?: Element, at?: Point): void {
      const r = stepTap(state, event, ttlMs);
      state = r.state;
      apply(r.effect, range, ctx, at);
    }
    clearMarker.current = () => feed({ type: "cancel" });

    const touchLike = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";
    const onDown = (e: PointerEvent) => {
      if (!touchLike(e)) return;
      active.add(e.pointerId);
      if (active.size > 1 || e.isPrimary === false) {
        down = null;
        pointerId = null;
        feed({ type: "cancel" });
        return;
      }
      pointerId = e.pointerId;
      down = { x: e.clientX, y: e.clientY, t: clock.current() };
    };
    const onMove = (e: PointerEvent) => {
      if (down && e.pointerId === pointerId && !isTap(down, { x: e.clientX, y: e.clientY }, 0)) {
        down = null; // a scroll or a drag, not a tap
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!touchLike(e)) return;
      active.delete(e.pointerId);
      if (e.pointerId !== pointerId || !down) return;
      const from = down;
      down = null;
      pointerId = null;
      const at = { x: e.clientX, y: e.clientY };
      const time = clock.current();
      const sel = doc.getSelection();
      const hasSelection = !!sel && !sel.isCollapsed && sel.toString().trim() !== "";
      const ctx = isPinnedPath(path.current) ? null : lookupTapContext(e.target);
      if (!isTap(from, at, time - from.t) || hasSelection || !ctx) {
        feed({ type: "tapOff" });
        return;
      }
      const range = wordRangeAt(at.x, at.y, doc, ctx);
      if (!range) {
        feed({ type: "tapOff" });
        return;
      }
      feed({ type: "tapOn", key: keyOf(range), time }, range, ctx, at);
    };
    const onCancel = (e: PointerEvent) => {
      active.delete(e.pointerId);
      if (e.pointerId === pointerId) {
        down = null;
        pointerId = null;
      }
      // a pointercancel is the browser taking the gesture over (scroll, native selection): the marker goes too
      feed({ type: "cancel" });
    };
    const onScroll = () => {
      down = null;
      feed({ type: "scroll" });
    };
    const onSelection = () => {
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim() !== "") feed({ type: "selection" });
    };
    const onResize = () => feed({ type: "cancel" });
    const opts = { capture: true, passive: true } as const;
    doc.addEventListener("pointerdown", onDown, opts);
    doc.addEventListener("pointermove", onMove, opts);
    doc.addEventListener("pointerup", onUp, opts);
    doc.addEventListener("pointercancel", onCancel, opts);
    doc.addEventListener("scroll", onScroll, opts);
    doc.addEventListener("selectionchange", onSelection);
    const win = doc.defaultView;
    win?.addEventListener("resize", onResize);
    return () => {
      doc.removeEventListener("pointerdown", onDown, opts);
      doc.removeEventListener("pointermove", onMove, opts);
      doc.removeEventListener("pointerup", onUp, opts);
      doc.removeEventListener("pointercancel", onCancel, opts);
      doc.removeEventListener("scroll", onScroll, opts);
      doc.removeEventListener("selectionchange", onSelection);
      win?.removeEventListener("resize", onResize);
      stopTimer();
      stopReassert();
      mark.clear();
      clearMarker.current = null;
    };
  }, [enabled, doc, ttlMs]);
}
