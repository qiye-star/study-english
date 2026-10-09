import { describe, expect, it } from "vitest";
import { dragHeight, keyboardOpen, nearestSnap, snapHeights, stepSnap } from "./dock-snap";

describe("dock snapping", () => {
  it("computes snap heights for 812 and 667 viewports", () => {
    expect(snapHeights(812)).toEqual({ row: 52, mid: 227, max: 325 });
    expect(snapHeights(667)).toEqual({ row: 52, mid: 187, max: 267 });
  });
  it("snaps to the nearest height and clamps drags", () => {
    expect(nearestSnap(60, 812)).toBe("row");
    expect(nearestSnap(250, 812)).toBe("mid");
    expect(nearestSnap(300, 812)).toBe("max");
    expect(dragHeight(227, -400, 812)).toBe(325);
    expect(dragHeight(227, 400, 812)).toBe(52);
    expect(dragHeight(227, -20, 812)).toBe(247);
  });
  it("never lets the middle snap fall below the row on tiny viewports", () => {
    const h = snapHeights(120);
    expect(h.row).toBe(52);
    expect(h.mid).toBeGreaterThanOrEqual(52);
    expect(h.max).toBeGreaterThanOrEqual(h.mid);
  });
  it("steps one snap up or down for the keyboard", () => {
    expect(stepSnap("row", 1)).toBe("mid");
    expect(stepSnap("mid", 1)).toBe("max");
    expect(stepSnap("max", 1)).toBe("max");
    expect(stepSnap("max", -1)).toBe("mid");
    expect(stepSnap("row", -1)).toBe("row");
  });
});

describe("keyboard detection", () => {
  const base = { layoutHeight: 812, maxVisualHeight: 812, inputFocused: false, coarsePointer: true };
  it("uses visualViewport shrink when available", () => {
    expect(keyboardOpen({ ...base, visualHeight: 480 })).toBe(true);
    expect(keyboardOpen({ ...base, visualHeight: 760 })).toBe(false);
    expect(keyboardOpen({ ...base, visualHeight: 609 })).toBe(false); // exactly 25% is not "more than"
  });
  it("falls back to focus on touch devices", () => {
    expect(keyboardOpen({ ...base, visualHeight: null, inputFocused: true })).toBe(true);
    expect(keyboardOpen({ ...base, visualHeight: null, inputFocused: true, coarsePointer: false })).toBe(false);
    expect(keyboardOpen({ ...base, visualHeight: null, inputFocused: false })).toBe(false);
  });
});
