import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { getStats, tzOffsetMinutes } from "./stats-api";

describe("stats api", () => {
  it("sends the period and the local UTC offset (R23)", async () => {
    const mock = createFetchMock({ "GET /api/stats": () => json({ days: 30, today: "2026-10-05", daily: [], streak_days: 2 }) });
    const out = await getStats(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), 30);
    expect(mock.calls[0].url.searchParams.get("days")).toBe("30");
    expect(mock.calls[0].url.searchParams.get("tz_offset_minutes")).toBe(String(tzOffsetMinutes()));
    expect(out.streakDays).toBe(2);
  });
  it("converts getTimezoneOffset to minutes east of UTC", () => {
    expect(tzOffsetMinutes({ getTimezoneOffset: () => -480 } as Date)).toBe(480);
    expect(tzOffsetMinutes({ getTimezoneOffset: () => 300 } as Date)).toBe(-300);
    expect(tzOffsetMinutes({ getTimezoneOffset: () => 0 } as Date)).toBe(0);
  });
  it("keeps the offset inside the server range (-720..840)", () => {
    expect(tzOffsetMinutes({ getTimezoneOffset: () => -900 } as Date)).toBe(840);
    expect(tzOffsetMinutes({ getTimezoneOffset: () => 800 } as Date)).toBe(-720);
    expect(tzOffsetMinutes({ getTimezoneOffset: () => Number.NaN } as Date)).toBe(0);
  });
});
