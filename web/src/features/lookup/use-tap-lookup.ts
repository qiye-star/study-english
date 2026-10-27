import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { isPinnedPath } from "~/lib/glass-flag";
import { lookupTapContext } from "~/lib/lookup-context";
import { selectWordAt } from "~/lib/select-word";
import { isTap, isUserSelection, type Point } from "./tap-lookup";

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
}

/**
 * One tap on a word selects it and calls `onSelect()`, which shows the lookup bar (plan 2026-10-27 one-tap-lookup).
 * Document-level passive pointer listeners: touch, pen, and the desktop primary mouse button (not the second press of a
 * double-click, so native double-click selection is untouched; a drag is never a click, so native drag selection is too).
 * A tap (moved <= 8 px, held <= 450 ms, single finger / one click) on a word of a `[data-lookup-context]` outside interactive elements,
 * `data-lookup-tap="off"` subtrees and pinned routes (library, changelog) is a lookup. It is skipped when the user's own
 * selection was present when the press began (the browser then only clears it); the selection the last tap made does not count.
 * Never preventDefault, never changes user-select / touch-action, never logs. Needs a Router (route checks).
 */
export function useTapLookup({ enabled, onSelect, doc = document, now = perfNow }: TapLookupOptions): void {
  const { pathname } = useLocation();
  const latest = useRef(onSelect);
  const clock = useRef(now);
  const path = useRef(pathname);
  useEffect(() => {
    latest.current = onSelect;
    clock.current = now;
    path.current = pathname;
  });
  useEffect(() => {
    if (!enabled) return;
    let ours: Range | null = null; // the word the last tap selected
    let pointerId: number | null = null;
    let down: (Point & { t: number; userSelection: boolean }) | null = null;
    const active = new Set<number>();
    let reassert: { off: () => void } | null = null;
    const stopReassert = () => {
      reassert?.off();
      reassert = null;
    };
    const lookUp = (at: Point, ctx: Element) => {
      // no user selection was present at press time, so a remaining one is our own last pick: drop it first
      doc.getSelection()?.removeAllRanges();
      if (!selectWordAt(at.x, at.y, doc, ctx)) return;
      const sel = doc.getSelection();
      const picked = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
      ours = picked;
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
        const t = setTimeout(stopReassert, REASSERT_MS);
        const off = () => { clearTimeout(t); doc.removeEventListener("click", onClick, true); };
        doc.addEventListener("click", onClick, true);
        stopReassert();
        reassert = { off };
      }
    };

    // touch and pen, or the primary mouse button when it is not the second click of a double-click (the browser selects the word then)
    const isPress = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen"
      || (e.pointerType === "mouse" && e.button === 0 && e.detail <= 1);
    const onDown = (e: PointerEvent) => {
      if (!isPress(e)) return;
      active.add(e.pointerId);
      if (active.size > 1 || e.isPrimary === false) {
        down = null;
        pointerId = null;
        return;
      }
      pointerId = e.pointerId;
      // read the selection at press time: a desktop mousedown collapses it before the mouseup
      down = { x: e.clientX, y: e.clientY, t: clock.current(), userSelection: isUserSelection(doc.getSelection(), ours) };
    };
    const onMove = (e: PointerEvent) => {
      if (down && e.pointerId === pointerId && !isTap(down, { x: e.clientX, y: e.clientY }, 0)) {
        down = null; // a scroll or a drag, not a tap
      }
    };
    const onUp = (e: PointerEvent) => {
      active.delete(e.pointerId);
      if (e.pointerId !== pointerId || !down) return;
      const from = down;
      down = null;
      pointerId = null;
      const at = { x: e.clientX, y: e.clientY };
      if (!isTap(from, at, clock.current() - from.t) || from.userSelection || isPinnedPath(path.current)) return;
      const ctx = lookupTapContext(e.target);
      if (ctx) lookUp(at, ctx);
    };
    const onCancel = (e: PointerEvent) => {
      active.delete(e.pointerId);
      if (e.pointerId === pointerId) {
        down = null;
        pointerId = null;
      }
    };
    const opts = { capture: true, passive: true } as const;
    doc.addEventListener("pointerdown", onDown, opts);
    doc.addEventListener("pointermove", onMove, opts);
    doc.addEventListener("pointerup", onUp, opts);
    doc.addEventListener("pointercancel", onCancel, opts);
    return () => {
      doc.removeEventListener("pointerdown", onDown, opts);
      doc.removeEventListener("pointermove", onMove, opts);
      doc.removeEventListener("pointerup", onUp, opts);
      doc.removeEventListener("pointercancel", onCancel, opts);
      stopReassert();
      ours = null;
    };
  }, [enabled, doc]);
}
