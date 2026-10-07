import { describe, expect, it } from "vitest";
import { IDLE, SHORT_PRESS_MS, holdReducer, type HoldEffect, type HoldEvent, type HoldModel, type HoldState } from "./hold-to-talk";

const W = 400;
const model = (state: HoldState, micReady = state !== "pressing"): HoldModel =>
  state === "idle" ? IDLE : { state, startY: 500, downAt: 0, width: W, micReady };
const EVENTS: Record<string, HoldEvent> = {
  down: { type: "down", x: 100, y: 500, t: 0, width: W },
  "mic-ready": { type: "mic-ready" },
  "mic-failed": { type: "mic-failed" },
  move: { type: "move", x: 100, y: 500 }, // 原地不动
  up: { type: "up", t: 1000 },
  cancel: { type: "cancel" },
  max: { type: "max" },
  key: { type: "key" },
  escape: { type: "escape" },
  reset: { type: "reset" },
};
const start: HoldEffect = { type: "start" };
const send: HoldEffect = { type: "finish", deliver: "send" };
const fill: HoldEffect = { type: "finish", deliver: "fill" };
const discard = (reason: "short" | "not-ready" | "slide" | "cancel"): HoldEffect => ({ type: "discard", reason });

type Row = [HoldState, HoldEffect[]];
const same = (s: HoldState): Row => [s, []];
const toIdle = (...effects: HoldEffect[]): Row => ["idle", effects];
/** 6 个状态 × 10 个事件,逐格写明期望(R11) */
const TABLE: Record<HoldState, Record<string, Row>> = {
  idle: {
    down: ["pressing", [start]], "mic-ready": same("idle"), "mic-failed": same("idle"), move: same("idle"), up: same("idle"),
    cancel: same("idle"), max: same("idle"), key: ["keyboard", [start]], escape: same("idle"), reset: same("idle"),
  },
  pressing: {
    down: same("pressing"), "mic-ready": same("recording"), "mic-failed": toIdle(), move: same("pressing"), up: toIdle(discard("not-ready")),
    cancel: toIdle(discard("cancel")), max: same("pressing"), key: same("pressing"), escape: toIdle(discard("cancel")), reset: toIdle(),
  },
  recording: {
    down: same("recording"), "mic-ready": same("recording"), "mic-failed": toIdle(), move: same("recording"), up: toIdle(send),
    cancel: toIdle(discard("cancel")), max: toIdle(send), key: same("recording"), escape: toIdle(discard("cancel")), reset: toIdle(),
  },
  "armed-cancel": {
    down: same("armed-cancel"), "mic-ready": same("armed-cancel"), "mic-failed": toIdle(), move: same("recording"), up: toIdle(discard("slide")),
    cancel: toIdle(discard("cancel")), max: toIdle(discard("slide")), key: same("armed-cancel"), escape: toIdle(discard("cancel")), reset: toIdle(),
  },
  "armed-text": {
    down: same("armed-text"), "mic-ready": same("armed-text"), "mic-failed": toIdle(), move: same("recording"), up: toIdle(fill),
    cancel: toIdle(discard("cancel")), max: toIdle(fill), key: same("armed-text"), escape: toIdle(discard("cancel")), reset: toIdle(),
  },
  keyboard: {
    down: same("keyboard"), "mic-ready": same("keyboard"), "mic-failed": toIdle(), move: same("keyboard"), up: same("keyboard"),
    cancel: toIdle(discard("cancel")), max: toIdle(send), key: toIdle(send), escape: toIdle(discard("cancel")), reset: toIdle(),
  },
};

describe("holdReducer: every state × every event", () => {
  const cases = Object.entries(TABLE).flatMap(([state, row]) =>
    Object.entries(row).map(([event, expected]) => [state as HoldState, event, expected] as const));
  it("the table covers all 60 transitions", () => expect(cases).toHaveLength(60));
  it.each(cases)("%s + %s", (state, event, [next, effects]) => {
    const out = holdReducer(model(state), EVENTS[event]);
    expect(out.model.state).toBe(next);
    expect(out.effects).toEqual(effects);
  });
});

describe("holdReducer: timing and geometry", () => {
  const recording = holdReducer(holdReducer(IDLE, EVENTS.down).model, EVENTS["mic-ready"]).model;

  it("a release shorter than 300 ms is a mis-tap, both before and after the microphone is ready", () => {
    expect(holdReducer(recording, { type: "up", t: SHORT_PRESS_MS - 1 }).effects).toEqual([discard("short")]);
    expect(holdReducer(recording, { type: "up", t: SHORT_PRESS_MS }).effects).toEqual([send]);
    const pressing = holdReducer(IDLE, EVENTS.down).model;
    expect(holdReducer(pressing, { type: "up", t: 120 }).effects).toEqual([discard("short")]);
  });

  it("sliding up 80 px arms the zone under the finger: left half cancels, right half fills", () => {
    expect(holdReducer(recording, { type: "move", x: 100, y: 500 - 79 }).model.state).toBe("recording");
    expect(holdReducer(recording, { type: "move", x: 100, y: 500 - 80 }).model.state).toBe("armed-cancel");
    expect(holdReducer(recording, { type: "move", x: 300, y: 500 - 120 }).model.state).toBe("armed-text");
  });

  it("moving sideways while armed switches zones; coming back below 40 px disarms (hysteresis)", () => {
    const armed = holdReducer(recording, { type: "move", x: 100, y: 400 }).model;
    expect(holdReducer(armed, { type: "move", x: 250, y: 400 }).model.state).toBe("armed-text");
    expect(holdReducer(armed, { type: "move", x: 100, y: 500 - 41 }).model.state).toBe("armed-cancel");
    expect(holdReducer(armed, { type: "move", x: 100, y: 500 - 39 }).model.state).toBe("recording");
  });

  it("does not arm before the microphone is ready", () => {
    const pressing = holdReducer(IDLE, EVENTS.down).model;
    expect(holdReducer(pressing, { type: "move", x: 100, y: 300 }).model.state).toBe("pressing");
  });

  it("keyboard: a second key before the microphone is ready discards", () => {
    const kb = holdReducer(IDLE, EVENTS.key).model;
    expect(kb.micReady).toBe(false);
    expect(holdReducer(kb, EVENTS.key)).toEqual({ model: IDLE, effects: [discard("not-ready")] });
    const ready = holdReducer(kb, EVENTS["mic-ready"]).model;
    expect(ready.micReady).toBe(true);
    expect(holdReducer(ready, EVENTS.key).effects).toEqual([send]);
  });

  it("is pure: the input model is not mutated", () => {
    const before = { ...recording };
    holdReducer(recording, { type: "move", x: 300, y: 300 });
    expect(recording).toEqual(before);
  });
});
