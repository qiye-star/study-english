import { describe, expect, it } from "vitest";
import { IDLE, TAP_MARK_TTL_MS, isTap, stepTap, type TapEvent, type TapState } from "./tap-lookup";

const marked = (key: string, at = 0): TapState => ({ kind: "marked", key, at });
const run = (state: TapState, ...events: TapEvent[]) => {
  const effects = [];
  for (const e of events) {
    const r = stepTap(state, e);
    state = r.state;
    effects.push(r.effect.kind);
  }
  return { state, effects };
};

describe("tap-lookup state machine", () => {
  it("the first tap marks the word", () => {
    expect(stepTap(IDLE, { type: "tapOn", key: "a:0", time: 10 })).toEqual({ state: marked("a:0", 10), effect: { kind: "mark", key: "a:0" } });
  });

  it("a second tap on the same word looks it up and goes back to idle", () => {
    expect(stepTap(marked("a:0", 10), { type: "tapOn", key: "a:0", time: 500 })).toEqual({ state: IDLE, effect: { kind: "lookup", key: "a:0" } });
  });

  it("a tap on another word moves the marker (and restarts its clock)", () => {
    expect(stepTap(marked("a:0", 10), { type: "tapOn", key: "a:6", time: 900 })).toEqual({ state: marked("a:6", 900), effect: { kind: "mark", key: "a:6" } });
  });

  it("the same offset in another text node is another word", () => {
    expect(stepTap(marked("1:0"), { type: "tapOn", key: "2:0", time: 5 }).effect.kind).toBe("mark");
  });

  it("tapping elsewhere clears a marker and is a no-op when idle", () => {
    expect(stepTap(marked("a:0"), { type: "tapOff" })).toEqual({ state: IDLE, effect: { kind: "clear" } });
    expect(stepTap(IDLE, { type: "tapOff" })).toEqual({ state: IDLE, effect: { kind: "none" } });
  });

  it("scroll, a selection appearing and a cancel (slop / pointercancel / multi-touch) clear a marker", () => {
    for (const type of ["scroll", "selection", "cancel"] as const) {
      expect(stepTap(marked("a:0"), { type })).toEqual({ state: IDLE, effect: { kind: "clear" } });
      expect(stepTap(IDLE, { type })).toEqual({ state: IDLE, effect: { kind: "none" } });
    }
  });

  it("a tick clears the marker only after the timeout", () => {
    expect(stepTap(marked("a:0", 100), { type: "tick", time: 100 + TAP_MARK_TTL_MS - 1 })).toEqual({ state: marked("a:0", 100), effect: { kind: "none" } });
    expect(stepTap(marked("a:0", 100), { type: "tick", time: 100 + TAP_MARK_TTL_MS })).toEqual({ state: IDLE, effect: { kind: "clear" } });
    expect(stepTap(IDLE, { type: "tick", time: 99999 }).effect.kind).toBe("none");
  });

  it("a second tap after the marker expired is a fresh first tap, not a lookup", () => {
    expect(stepTap(marked("a:0", 0), { type: "tapOn", key: "a:0", time: TAP_MARK_TTL_MS + 1 })).toEqual({
      state: marked("a:0", TAP_MARK_TTL_MS + 1), effect: { kind: "mark", key: "a:0" },
    });
  });

  it("honours a custom timeout", () => {
    expect(stepTap(marked("a:0", 0), { type: "tick", time: 50 }, 50).effect.kind).toBe("clear");
  });

  it("walks a whole gesture: mark, move, mark, look up, then a new first tap marks again", () => {
    const { state, effects } = run(IDLE,
      { type: "tapOn", key: "w1", time: 0 }, { type: "tapOn", key: "w2", time: 100 }, { type: "tapOn", key: "w2", time: 200 },
      { type: "tapOn", key: "w2", time: 300 }, { type: "scroll" }, { type: "scroll" });
    expect(effects).toEqual(["mark", "mark", "lookup", "mark", "clear", "none"]);
    expect(state).toEqual(IDLE);
  });
});

describe("isTap", () => {
  it("accepts a still, short press", () => {
    expect(isTap({ x: 10, y: 10 }, { x: 10, y: 10 }, 80)).toBe(true);
  });
  it("rejects movement beyond 8 px (a scroll) and a long hold (the browser's own selection)", () => {
    expect(isTap({ x: 0, y: 0 }, { x: 8, y: 0 }, 50)).toBe(true);
    expect(isTap({ x: 0, y: 0 }, { x: 9, y: 0 }, 50)).toBe(false);
    expect(isTap({ x: 0, y: 0 }, { x: 6, y: 6 }, 50)).toBe(false);
    expect(isTap({ x: 0, y: 0 }, { x: 0, y: 0 }, 451)).toBe(false);
    expect(isTap({ x: 0, y: 0 }, { x: 0, y: 0 }, 450)).toBe(true);
  });
});
