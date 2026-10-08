import { describe, expect, it } from "vitest";
import { formatBytes, formatCompact, formatDuration, formatRelative, formatScore, scoreTone } from "./format";

describe("formatBytes", () => {
  it("formats across units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatBytes(12.34 * 1024 * 1024)).toBe("12.3 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.00 GB");
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("buckets by magnitude", () => {
    expect(formatRelative(null, now)).toBe("从未");
    expect(formatRelative(ago(10_000), now)).toBe("刚刚");
    expect(formatRelative(ago(5 * 60_000), now)).toBe("5 分钟前");
    expect(formatRelative(ago(3 * 3600_000), now)).toBe("3 小时前");
    expect(formatRelative(ago(2 * 86400_000), now)).toBe("2 天前");
    expect(formatRelative(ago(90 * 86400_000), now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("never goes negative for future timestamps", () => {
    expect(formatRelative(new Date(now + 60_000).toISOString(), now)).toBe("刚刚");
  });
});

describe("scores", () => {
  it("maps scores to tones at the 80/60 thresholds", () => {
    expect(scoreTone(100)).toBe("good");
    expect(scoreTone(80)).toBe("good");
    expect(scoreTone(79.9)).toBe("warn");
    expect(scoreTone(60)).toBe("warn");
    expect(scoreTone(59)).toBe("bad");
    expect(scoreTone(null)).toBe("none");
  });
  it("rounds and handles missing values", () => {
    expect(formatScore(87.6)).toBe("88");
    expect(formatScore(null)).toBe("—");
  });
  it("formats durations as m:ss", () => {
    expect(formatDuration(7400)).toBe("0:07");
    expect(formatDuration(125_000)).toBe("2:05");
  });
});

describe("formatCompact", () => {
  it("keeps small numbers with thousands separators", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(5932)).toBe("5,932");
  });
  it("uses 万 and 亿 for large numbers", () => {
    expect(formatCompact(10000)).toBe("1万");
    expect(formatCompact(23871)).toBe("2.4万");
    expect(formatCompact(118402)).toBe("12万");
    expect(formatCompact(150_000_000)).toBe("1.5亿");
  });
});
