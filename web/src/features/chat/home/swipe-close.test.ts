import { describe, expect, it } from "vitest";
import { swipeEnd, swipeMove, swipeStart } from "./swipe-close";

const drag = (width: number, ...points: Array<[number, number]>) =>
  points.reduce((s, [x, y]) => swipeMove(s, x, y), swipeStart(200, 300, width));

describe("swipe to close", () => {
  it("stays undecided inside the 10 px dead zone", () => {
    expect(drag(300, [195, 303]).taking).toBeNull();
  });

  it("lets vertical scrolling through", () => {
    const s = drag(300, [195, 330]);
    expect(s.taking).toBe(false);
    expect(s.offset).toBe(0);
    expect(swipeEnd(drag(300, [195, 330], [100, 340]))).toEqual({ close: false, swallowClick: false });
  });

  it("needs the horizontal move to beat 1.2 x the vertical one", () => {
    expect(drag(300, [187, 312]).taking).toBe(false); // dx 13, dy 12 -> not 1.2x
    expect(drag(300, [170, 312]).taking).toBe(true); // dx 30, dy 12
  });

  it("only takes over leftwards (the closing direction)", () => {
    expect(drag(300, [240, 301]).taking).toBe(false);
  });

  it("tracks the finger and clamps to the panel width", () => {
    expect(drag(300, [150, 300]).offset).toBe(-50);
    expect(drag(300, [-500, 300]).offset).toBe(-300);
  });

  it("closes past min(80, 25% width) and springs back otherwise; always swallows the click after a takeover", () => {
    expect(swipeEnd(drag(340, [100, 300]))).toEqual({ close: true, swallowClick: true }); // 100 > 80
    expect(swipeEnd(drag(340, [140, 300]))).toEqual({ close: false, swallowClick: true }); // 60 < 80
    expect(swipeEnd(drag(200, [145, 300]))).toEqual({ close: true, swallowClick: true }); // 55 > 25% of 200 = 50
  });
});
