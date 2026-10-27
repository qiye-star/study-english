import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { isPinnedPath } from "~/lib/glass-flag";
import { lookupTapContext } from "~/lib/lookup-context";
import { selectWordAt } from "~/lib/select-word";
import { isTap, isUserSelection, type Point } from "./tap-lookup";

const perfNow = () => performance.now();
/** After a touch lookup the browser's own compat click may still collapse the selection: re-assert it for this long. */
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
 * Document-level passive listeners. Touch and pen always count as a press. The desktop mouse counts only as a plain click:
 * primary button, no Shift / Ctrl / Meta / Alt, and click count 1. A second or third click (double / triple click) is left to the
 * browser so native word and paragraph selection still happen; Shift / Ctrl / Meta / Alt presses extend the native selection.
 * Chromium's PointerEvent.detail is always 0, so the click count comes from the `mousedown` event (MouseEvent.detail), which
 * fires between `pointerdown` and `pointerup`.
 * A press is a lookup when it moved <= 8 px, was held <= 450 ms, and the word sits in a `[data-lookup-context]` outside
 * interactive elements, `data-lookup-tap="off"` subtrees and pinned routes (library, changelog). It is skipped when the user's
 * own selection was present when the press began (the browser then only clears it); the selection the last tap made does not count.
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
    let down: (Point & { t: number; userSelection: boolean; mouse: boolean }) | null = null;
    let mouseClicks = 0; // click count (MouseEvent.detail) of the mousedown that belongs to the current press
    const active = new Set<number>();
    let reassert: { off: () => void } | null = null;
    const stopReassert = () => {
      reassert?.off();
      reassert = null;
    };
    const lookUp = (at: Point, ctx: Element, mouse: boolean) => {
      // no user selection was present at press time, so a remaining one is our own last pick: drop it first
      doc.getSelection()?.removeAllRanges();
      if (!selectWordAt(at.x, at.y, doc, ctx)) return;
      const sel = doc.getSelection();
      const picked = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
      ours = picked;
      latest.current();
      if (picked && !mouse) {
        // Android: the compat click after pointerup can collapse a selection set during the tap; put it back once.
        // Mouse clicks skip this so a native double / triple click keeps its own selection.
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

    const modifiers = (e: MouseEvent) => e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
    /** touch and pen always press; the mouse only as a plain primary click (no modifiers; the click count is checked on pointerup) */
    const isPress = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen"
      || (e.pointerType === "mouse" && e.button === 0 && !modifiers(e));
    const onDown = (e: PointerEvent) => {
      mouseClicks = 0; // the mousedown of this press (if any) comes after pointerdown and sets it again
      if (e.pointerType !== "touch" && e.pointerType !== "pen" && !isPress(e)) {
        down = null;
        pointerId = null;
        return;
      }
      active.add(e.pointerId);
      if (active.size > 1 || e.isPrimary === false) {
        down = null;
        pointerId = null;
        return;
      }
      pointerId = e.pointerId;
      // read the selection at press time: a desktop mousedown collapses it before the mouseup
      down = {
        x: e.clientX, y: e.clientY, t: clock.current(),
        userSelection: isUserSelection(doc.getSelection(), ours), mouse: e.pointerType === "mouse",
      };
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) mouseClicks = e.detail;
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
      if (from.mouse && mouseClicks >= 2) return; // double / triple click: native selection
      const ctx = lookupTapContext(e.target);
      if (ctx) lookUp(at, ctx, from.mouse);
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
    doc.addEventListener("mousedown", onMouseDown, opts);
    doc.addEventListener("pointermove", onMove, opts);
    doc.addEventListener("pointerup", onUp, opts);
    doc.addEventListener("pointercancel", onCancel, opts);
    return () => {
      doc.removeEventListener("pointerdown", onDown, opts);
      doc.removeEventListener("mousedown", onMouseDown, opts);
      doc.removeEventListener("pointermove", onMove, opts);
      doc.removeEventListener("pointerup", onUp, opts);
      doc.removeEventListener("pointercancel", onCancel, opts);
      stopReassert();
      ours = null;
    };
  }, [enabled, doc]);
}
