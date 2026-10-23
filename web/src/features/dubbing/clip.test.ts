import { describe, expect, it } from "vitest";
import { type ClipSeg, clipProblem, clipStats, selectRange } from "./clip";

const seg = (idx: number, startMs: number, endMs: number, speaker: ClipSeg["speaker"] = "B"): ClipSeg => ({ idx, startMs, endMs, speaker });
const LIMITS = { maxLines: 12, maxMs: 90_000 };

describe("selectRange (first tap = start, second = end, third restarts)", () => {
  it("first tap starts a selection with no end yet", () => {
    expect(selectRange(null, 4)).toEqual({ from: 4, to: null });
  });

  it("second tap closes it; a reversed second tap swaps the ends", () => {
    expect(selectRange({ from: 4, to: null }, 7)).toEqual({ from: 4, to: 7 });
    expect(selectRange({ from: 4, to: null }, 1)).toEqual({ from: 1, to: 4 });
  });

  it("tapping the same sentence twice gives a one-sentence clip", () => {
    expect(selectRange({ from: 3, to: null }, 3)).toEqual({ from: 3, to: 3 });
  });

  it("a third tap starts over from the new sentence", () => {
    expect(selectRange({ from: 1, to: 4 }, 6)).toEqual({ from: 6, to: null });
  });
});

describe("clipStats and clipProblem (same codes as the server, plan L5 R6)", () => {
  const segs = [seg(0, 0, 1000, "A"), seg(1, 1000, 2000, "B"), seg(2, 2000, 3000, "A")];

  it("counts lines, milliseconds from the first start to the last end, and the chosen role's lines", () => {
    expect(clipStats(segs, 0, 2, "A")).toEqual({ valid: true, lines: 3, ms: 3000, mine: 2 });
    expect(clipStats(segs, 1, 1, "A")).toEqual({ valid: true, lines: 1, ms: 1000, mine: 0 });
  });

  it("reports an invalid range instead of throwing", () => {
    expect(clipStats(segs, 2, 1, "A").valid).toBe(false);
    expect(clipStats(segs, -1, 1, "A").valid).toBe(false);
    expect(clipStats(segs, 0, 3, "A").valid).toBe(false);
  });

  it("is fine when the limits are met exactly", () => {
    const exact = Array.from({ length: 12 }, (_, i) => seg(i, i * 7500, i * 7500 + 7500, "A"));
    expect(clipProblem(clipStats(exact, 0, 11, "A"), LIMITS)).toBeNull();
  });

  it("13 lines is too long even when short", () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => seg(i, i * 100, i * 100 + 100, "A"));
    expect(clipProblem(clipStats(thirteen, 0, 12, "A"), LIMITS)).toBe("clip_too_long");
  });

  it("12 lines over 90 000 ms is too long", () => {
    const long = Array.from({ length: 12 }, (_, i) => seg(i, i * 7501, i * 7501 + 7501, "A"));
    expect(clipProblem(clipStats(long, 0, 11, "A"), LIMITS)).toBe("clip_too_long");
  });

  it("a clip with no line of the chosen role is refused", () => {
    expect(clipProblem(clipStats(segs, 1, 1, "A"), LIMITS)).toBe("role_missing");
  });

  it("a monologue (every line is the chosen role) is allowed", () => {
    const solo = [seg(0, 0, 500, "A"), seg(1, 500, 900, "A")];
    expect(clipProblem(clipStats(solo, 0, 1, "A"), LIMITS)).toBeNull();
  });

  it("an invalid range is reported as clip", () => {
    expect(clipProblem(clipStats(segs, 2, 1, "A"), LIMITS)).toBe("clip");
  });

  it("unlabelled lines (speaker null) count as the other side, not as the role", () => {
    const mixed = [seg(0, 0, 500, null), seg(1, 500, 900, "A")];
    expect(clipStats(mixed, 0, 1, "A").mine).toBe(1);
  });
});
