import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration } from "./format";

describe("library formatting (R-L18)", () => {
  it("formats sizes in MiB with one decimal below 100 and GB from 1024 MiB", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
    expect(formatBytes(2000 * 1024 * 1024)).toBe("2.0 GB");
    expect(formatBytes(0)).toBe("0.0 MB");
  });

  it("formats durations as m:ss or h:mm:ss", () => {
    expect(formatDuration(125_000)).toBe("2:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(999)).toBe("0:00");
    expect(formatDuration(null)).toBe("--:--");
  });
});
