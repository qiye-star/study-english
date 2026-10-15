import { describe, expect, it } from "vitest";
import { CLICK_SWALLOW_MS, LONG_PRESS_MS, LONG_PRESS_SLOP_PX, createLongPress, movedTooFar } from "./long-press";

describe("long-press constants (R-L2 / R-L3)", () => {
  it("are 450 ms, 8 px and 400 ms", () => {
    expect([LONG_PRESS_MS, LONG_PRESS_SLOP_PX, CLICK_SWALLOW_MS]).toEqual([450, 8, 400]);
  });
});

describe("movedTooFar", () => {
  it("allows exactly the slop and rejects anything beyond it (Euclidean)", () => {
    expect(movedTooFar({ x: 0, y: 0 }, 8, 0)).toBe(false);
    expect(movedTooFar({ x: 0, y: 0 }, 9, 0)).toBe(true);
    expect(movedTooFar({ x: 0, y: 0 }, 6, 6)).toBe(true); // 8.49 px
    expect(movedTooFar({ x: 10, y: 10 }, 5, 5)).toBe(false);
  });
});

describe("createLongPress", () => {
  it("fires once for a press that is still held when the timer runs out", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    expect(lp.pressing()).toBe(true);
    expect(lp.fire()).toBe("a");
    expect(lp.fire()).toBeNull(); // only once
    expect(lp.pressing()).toBe(false);
  });

  it("does not fire after an early release, a cancel or a move beyond the slop", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    lp.up(100);
    expect(lp.fire()).toBeNull();
    lp.down("a", 0, 0);
    lp.cancel();
    expect(lp.fire()).toBeNull();
    lp.down("a", 0, 0);
    expect(lp.move(3, 3)).toBe(false); // a small wobble is fine
    expect(lp.move(20, 0)).toBe(true);
    expect(lp.fire()).toBeNull();
  });

  it("ignores movement once it has fired (the finger may settle)", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    lp.fire();
    expect(lp.move(50, 50)).toBe(false);
  });

  it("swallows exactly one click right after releasing a fired press", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    lp.fire();
    lp.up(1000);
    expect(lp.swallowClick(1000 + CLICK_SWALLOW_MS)).toBe(true);
    expect(lp.swallowClick(1000 + CLICK_SWALLOW_MS)).toBe(false);
  });

  it("does not swallow a click that comes too late, after a plain tap, or after a cancel", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    lp.fire();
    lp.up(1000);
    expect(lp.swallowClick(1000 + CLICK_SWALLOW_MS + 1)).toBe(false);
    lp.down("a", 0, 0);
    lp.up(2000); // released before firing
    expect(lp.swallowClick(2001)).toBe(false);
    lp.down("a", 0, 0);
    lp.fire();
    lp.cancel();
    expect(lp.swallowClick(3001)).toBe(false);
  });

  it("a new press forgets a pending swallow window", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    lp.fire();
    lp.up(1000);
    lp.down("b", 0, 0);
    lp.up(1050);
    expect(lp.swallowClick(1060)).toBe(false);
  });
});
