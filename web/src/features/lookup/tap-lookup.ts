/**
 * Tap-to-lookup state machine (tap an English word to underline it, tap the same word again to look it up).
 * Pure: no timers, no DOM. The hook (use-tap-lookup.ts) feeds it events and performs the returned effect.
 *
 *   idle   --tapOn(k)-->  marked{k}      effect mark(k)
 *   marked --tapOn(k)-->  idle           effect lookup(k)   (same word, still fresh)
 *   marked --tapOn(j)-->  marked{j}      effect mark(j)     (the marker moves)
 *   marked --tapOff | scroll | selection | cancel | tick(expired)--> idle   effect clear
 *   idle   --anything but tapOn-->       idle                effect none
 */
export const TAP_MARK_TTL_MS = 6000;
export const TAP_SLOP_PX = 8;
/** A press held longer than this is a long press (the browser's own selection), not a tap. */
export const TAP_MAX_MS = 450;

export type TapState = { kind: "idle" } | { kind: "marked"; key: string; at: number };
export type TapEvent =
  | { type: "tapOn"; key: string; time: number }
  | { type: "tapOff" }
  | { type: "scroll" }
  | { type: "selection" }
  | { type: "cancel" }
  | { type: "tick"; time: number };
export type TapEffect = { kind: "none" } | { kind: "mark"; key: string } | { kind: "lookup"; key: string } | { kind: "clear" };

export const IDLE: TapState = { kind: "idle" };
const NONE: TapEffect = { kind: "none" };

export const expired = (state: TapState, time: number, ttl = TAP_MARK_TTL_MS): boolean => state.kind === "marked" && time - state.at >= ttl;

export function stepTap(state: TapState, event: TapEvent, ttl = TAP_MARK_TTL_MS): { state: TapState; effect: TapEffect } {
  if (event.type === "tapOn") {
    if (state.kind === "marked" && state.key === event.key && !expired(state, event.time, ttl)) {
      return { state: IDLE, effect: { kind: "lookup", key: event.key } };
    }
    return { state: { kind: "marked", key: event.key, at: event.time }, effect: { kind: "mark", key: event.key } };
  }
  if (state.kind === "idle") return { state, effect: NONE };
  if (event.type === "tick") return expired(state, event.time, ttl) ? { state: IDLE, effect: { kind: "clear" } } : { state, effect: NONE };
  return { state: IDLE, effect: { kind: "clear" } };
}

export interface Point { x: number; y: number }

/** A press is a tap when the finger stayed within `slop` px and did not stay down long enough to be a long press. */
export function isTap(from: Point, to: Point, heldMs: number, slop = TAP_SLOP_PX, maxMs = TAP_MAX_MS): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) <= slop && heldMs <= maxMs;
}
