import { afterEach, describe, expect, it, vi } from "vitest";
import { localDateString, tzOffsetMinutes } from "./tz-offset";

describe("tzOffsetMinutes", () => {
  it("is minutes east of UTC", () => {
    expect(tzOffsetMinutes({ getTimezoneOffset: () => -480 } as Date)).toBe(480);
    expect(tzOffsetMinutes({ getTimezoneOffset: () => 300 } as Date)).toBe(-300);
  });
  it("clamps to the server range and never returns -0 or NaN", () => {
    expect(tzOffsetMinutes({ getTimezoneOffset: () => -900 } as Date)).toBe(840);
    expect(tzOffsetMinutes({ getTimezoneOffset: () => 800 } as Date)).toBe(-720);
    expect(tzOffsetMinutes({ getTimezoneOffset: () => Number.NaN } as Date)).toBe(0);
    expect(Object.is(tzOffsetMinutes({ getTimezoneOffset: () => 0 } as Date), 0)).toBe(true);
  });
});

describe("localDateString", () => {
  afterEach(() => vi.useRealTimers());
  it("zero-pads and follows the local calendar", () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDateString(new Date(2026, 0, 6, 0, 0))).toBe("2026-01-06");
  });
  it("defaults to the (fake) clock and crosses midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 23, 23, 59, 59));
    expect(localDateString()).toBe("2026-10-23");
    vi.setSystemTime(new Date(2026, 9, 24, 0, 0, 1));
    expect(localDateString()).toBe("2026-10-24");
  });
});
