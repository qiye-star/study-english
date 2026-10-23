import { describe, expect, it } from "vitest";
import { countUpValue } from "./count-up";
import { fitScale, FIT_MIN } from "./greeting-fit";

describe("fitScale", () => {
  it("keeps 1 when the content fits", () => {
    expect(fitScale(500, () => 400)).toBe(1);
  });

  it("steps down by 0.05 until it fits", () => {
    expect(fitScale(300, (s) => 400 * s)).toBe(0.75);
  });

  it("never goes below 0.72", () => {
    expect(fitScale(100, () => 1000)).toBe(FIT_MIN);
  });
});

describe("countUpValue", () => {
  it("starts at 60% and ends at the target", () => {
    expect(countUpValue(20, 0)).toBe(12);
    expect(countUpValue(20, 1)).toBe(20);
    expect(countUpValue(20, 2)).toBe(20);
    expect(countUpValue(20, -1)).toBe(12);
    expect(countUpValue(0, 0.5)).toBe(0);
  });
});
