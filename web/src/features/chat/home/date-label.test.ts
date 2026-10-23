import { describe, expect, it } from "vitest";
import { dailyDateText, dateLabel, dayRelation, groupByActivityDay, localDayOf } from "./date-label";

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).toISOString();

describe("date labels", () => {
  it("says today, yesterday, or the date with the weekday (zh and en)", () => {
    expect(dateLabel("2026-10-23", "2026-10-23", "zh-CN")).toBe("今天");
    expect(dateLabel("2026-10-23", "2026-10-23", "en")).toBe("Today");
    expect(dateLabel("2026-10-22", "2026-10-23", "zh-CN")).toBe("昨天");
    expect(dateLabel("2026-10-22", "2026-10-23", "en")).toBe("Yesterday");
    expect(dateLabel("2026-10-21", "2026-10-23", "zh-CN")).toBe("2026-10-21 周三");
    expect(dateLabel("2026-10-21", "2026-10-23", "en")).toBe("Wed 2026-10-21");
  });

  it("crosses month and year boundaries when computing yesterday", () => {
    expect(dayRelation("2026-09-30", "2026-10-01")).toBe("yesterday");
    expect(dayRelation("2025-12-31", "2026-01-01")).toBe("yesterday");
    expect(dayRelation("2026-10-24", "2026-10-23")).toBe("date"); // the future is just a date
  });

  it("formats a default conversation's own day from dailyDate without any time-zone conversion", () => {
    expect(dailyDateText("2026-10-21", "zh-CN")).toBe("10月21日 周三");
    expect(dailyDateText("2026-10-21", "en")).toBe("Oct 21 Wed");
    expect(dailyDateText("not-a-date", "en")).toBe("not-a-date");
  });

  it("derives the local day of a timestamp", () => {
    expect(localDayOf(at(2026, 10, 23, 23))).toBe("2026-10-23");
    expect(localDayOf(at(2026, 1, 5, 0))).toBe("2026-01-05");
    expect(localDayOf("garbage")).toBeNull();
  });

  it("groups by the last-activity local day, keeping the server order", () => {
    const rows = [
      { id: "a", updatedAt: at(2026, 10, 23, 20) }, { id: "b", updatedAt: at(2026, 10, 23, 9) },
      { id: "c", updatedAt: at(2026, 10, 22, 22) }, { id: "d", updatedAt: at(2026, 10, 20, 8) },
    ];
    const groups = groupByActivityDay(rows, "2026-10-23");
    expect(groups.map((g) => [g.day, g.items.map((r) => r.id)])).toEqual([
      ["2026-10-23", ["a", "b"]], ["2026-10-22", ["c"]], ["2026-10-20", ["d"]],
    ]);
  });

  it("a default conversation from yesterday that was replied to today lands in today's group", () => {
    const row = { id: "daily", dailyDate: "2026-10-22", updatedAt: at(2026, 10, 23, 8) };
    expect(groupByActivityDay([row], "2026-10-23")[0].day).toBe("2026-10-23");
  });
});
