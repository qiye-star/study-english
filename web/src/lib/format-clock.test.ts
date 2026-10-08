import { describe, expect, it } from "vitest";
import { formatClock } from "./format-clock";

describe("formatClock", () => {
  it("formats the timer", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65_400)).toBe("01:05");
  });
});
