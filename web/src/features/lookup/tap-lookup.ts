/**
 * Single-tap lookup: the pure gesture rules (plan 2026-10-27 one-tap-lookup, R-T2 / R-T3). No state, no timers, no DOM writes.
 * The hook (use-tap-lookup.ts) decides from these whether a press is a lookup.
 */
export const TAP_SLOP_PX = 8;
/** A press held longer than this is a long press (the browser's own selection), not a tap. */
export const TAP_MAX_MS = 450;

export interface Point { x: number; y: number }

/** A press is a tap when the pointer stayed within `slop` px and did not stay down long enough to be a long press. */
export function isTap(from: Point, to: Point, heldMs: number, slop = TAP_SLOP_PX, maxMs = TAP_MAX_MS): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) <= slop && heldMs <= maxMs;
}

/** Same start and end boundaries (identity of the Range object does not matter). */
export function sameRange(a: Range, b: Range): boolean {
  return a.startContainer === b.startContainer && a.startOffset === b.startOffset
    && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
}

/**
 * Whether the current selection is text the user made: non-blank and not the word our last tap selected (`ours`).
 * A tap while it is true only clears it (the browser does that); it never starts a lookup.
 */
export function isUserSelection(sel: Selection | null, ours: Range | null): boolean {
  if (!sel || sel.isCollapsed || sel.toString().trim() === "") return false;
  if (ours && sel.rangeCount === 1 && sameRange(sel.getRangeAt(0), ours)) return false;
  return true;
}
