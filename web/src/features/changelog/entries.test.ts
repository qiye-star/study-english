import { describe, expect, it } from "vitest";
import type { ChangelogEntry, ChangelogTag } from "./api";
import { collapsedItems, filterByTag, formatDay, formatMonth, groupByMonth, presentTags, versionLabel } from "./entries";

const entry = (id: number, entryDate: string, tags: ChangelogTag[]): ChangelogEntry => ({
  id, entryDate, version: null, titleZh: `标题${id}`, titleEn: "", publishedAt: "", isNew: false,
  items: tags.map((tag, i) => ({ tag, zh: `条目${id}-${i}`, en: "" })),
});

describe("changelog helpers", () => {
  it("groups consecutive entries by month and keeps the order", () => {
    const groups = groupByMonth([entry(4, "2026-10-14", ["new"]), entry(3, "2026-10-02", ["fix"]), entry(2, "2026-09-28", ["new"]), entry(1, "2026-09-01", ["new"])]);
    expect(groups.map((g) => [g.key, g.entries.map((e) => e.id)])).toEqual([["2026-10", [4, 3]], ["2026-09", [2, 1]]]);
    expect(groupByMonth([])).toEqual([]);
  });

  it("lists the present tags in the canonical order", () => {
    expect(presentTags([entry(1, "2026-10-01", ["fix", "new"]), entry(2, "2026-10-02", ["library", "fix"])])).toEqual(["new", "fix", "library"]);
    expect(presentTags([])).toEqual([]);
  });

  it("filters the items of each entry and drops entries without a match", () => {
    const entries = [entry(1, "2026-10-01", ["new", "fix"]), entry(2, "2026-10-02", ["improve"]), entry(3, "2026-10-03", ["fix", "fix"])];
    expect(filterByTag(entries, "all")).toBe(entries);
    const fixes = filterByTag(entries, "fix");
    expect(fixes.map((e) => [e.id, e.items.length])).toEqual([[1, 1], [3, 2]]);
    expect(filterByTag(entries, "library")).toEqual([]);
    expect(entries[0].items).toHaveLength(2); // the input is not mutated
  });

  it("collapses to the first two items unless expanded", () => {
    expect(collapsedItems([1, 2, 3], false)).toEqual([1, 2]);
    expect(collapsedItems([1, 2, 3], true)).toEqual([1, 2, 3]);
    expect(collapsedItems([1, 2], false)).toEqual([1, 2]);
    expect(collapsedItems([], false)).toEqual([]);
  });

  it("formats months and days in the UI language without a time zone shift", () => {
    expect(formatMonth("2026-10", "en")).toBe("October 2026");
    expect(formatMonth("2026-10", "zh-CN")).toBe("2026年10月");
    expect(formatDay("2026-10-14", "en")).toBe("October 14");
    expect(formatDay("2026-10-14", "zh-CN")).toBe("10月14日");
    expect(formatDay("garbage", "en")).toBe("garbage");
    expect(formatMonth("2026-10", "not a language")).toBe("2026-10");
  });

  it("labels versions", () => {
    expect(versionLabel(null)).toBeNull();
    expect(versionLabel("  ")).toBeNull();
    expect(versionLabel("1.12")).toBe("v1.12");
    expect(versionLabel("v1.12")).toBe("v1.12");
    expect(versionLabel("beta-2")).toBe("beta-2");
  });
});
