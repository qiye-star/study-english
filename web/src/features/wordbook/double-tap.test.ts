import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MS, createTapTracker, isDoubleTap } from "./double-tap";

describe("isDoubleTap", () => {
  it("needs a previous tap on the same target inside the window", () => {
    expect(isDoubleTap(null, "a", 1000)).toBe(false);
    expect(isDoubleTap({ id: "a", at: 1000 }, "a", 1000 + DOUBLE_TAP_MS)).toBe(true);
    expect(isDoubleTap({ id: "a", at: 1000 }, "a", 1000 + DOUBLE_TAP_MS + 1)).toBe(false);
    expect(isDoubleTap({ id: "a", at: 1000 }, "b", 1100)).toBe(false);
    expect(isDoubleTap({ id: "a", at: 1000 }, "a", 900)).toBe(false); // the clock went backwards
  });
});

describe("createTapTracker", () => {
  it("fires on the second tap and counts again from the third", () => {
    const t = createTapTracker();
    expect(t.tap("a", 1000)).toBe(false);
    expect(t.tap("a", 1200)).toBe(true);
    expect(t.tap("a", 1300)).toBe(false); // third tap starts a new pair
    expect(t.tap("a", 1450)).toBe(true);
  });

  it("restarts when the second tap lands on another row or too late", () => {
    const t = createTapTracker();
    t.tap("a", 1000);
    expect(t.tap("b", 1100)).toBe(false);
    expect(t.tap("b", 1500)).toBe(false);
  });

  it("lets a native dblclick catch a slow double click, and ignores the one that follows a recognised double tap", () => {
    const t = createTapTracker();
    t.tap("a", 1000);
    expect(t.tap("a", 1100)).toBe(true);
    expect(t.dblclick(1110)).toBe(false); // the browser's own dblclick right after: duplicate
    t.tap("a", 5000);
    t.tap("a", 5500); // 500 ms apart: not a double tap by timing
    expect(t.dblclick(5510)).toBe(true); // but the system called it a double click
    expect(t.dblclick(5600)).toBe(false);
  });

  it("reset forgets the pending tap", () => {
    const t = createTapTracker();
    t.tap("a", 1000);
    t.reset();
    expect(t.tap("a", 1100)).toBe(false);
  });
});
