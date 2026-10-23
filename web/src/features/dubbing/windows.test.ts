import { describe, expect, it } from "vitest";
import type { ClipSeg } from "./clip";
import { countdownAt, lineWindows, muteAt, phaseAt } from "./windows";

const seg = (idx: number, startMs: number, endMs: number, speaker: ClipSeg["speaker"] = "B"): ClipSeg => ({ idx, startMs, endMs, speaker });
const OPTS = { before: 300, after: 600 };

describe("lineWindows (plan L5 R14)", () => {
  it("an isolated own line gets -300 / +600 ms", () => {
    const segs = [seg(0, 0, 1000, "B"), seg(1, 5000, 6000, "A"), seg(2, 9000, 9500, "B")];
    expect(lineWindows(segs, 1, 1, "A", OPTS)).toEqual([{ idx: 1, startMs: 4700, endMs: 6600, lineStartMs: 5000, lineEndMs: 6000 }]);
  });

  it("the start is clamped to the end of an other-side line just before it", () => {
    const segs = [seg(0, 0, 1000, "B"), seg(1, 1100, 2000, "A")];
    expect(lineWindows(segs, 1, 1, "A", OPTS)[0].startMs).toBe(1000);
  });

  it("the end is clamped to the start of an other-side line just after it", () => {
    const segs = [seg(0, 0, 1000, "A"), seg(1, 1200, 2000, "B")];
    expect(lineWindows(segs, 0, 0, "A", OPTS)[0].endMs).toBe(1200);
  });

  it("a touching other-side neighbour leaves no pre-roll or post-roll", () => {
    const segs = [seg(0, 0, 1000, "B"), seg(1, 1000, 2000, "A"), seg(2, 2000, 3000, "B")];
    expect(lineWindows(segs, 1, 1, "A", OPTS)).toEqual([{ idx: 1, startMs: 1000, endMs: 2000, lineStartMs: 1000, lineEndMs: 2000 }]);
  });

  it("the lower bound is 0 when the first sentence has no earlier sentence", () => {
    const segs = [seg(0, 100, 900, "A"), seg(1, 5000, 5500, "B")];
    expect(lineWindows(segs, 0, 0, "A", OPTS)[0].startMs).toBe(0);
  });

  it("two own lines whose windows overlap are cut at the middle of the gap between them", () => {
    const segs = [seg(0, 0, 1000, "A"), seg(1, 1100, 2000, "A")];
    const [a, b] = lineWindows(segs, 0, 1, "A", OPTS);
    expect(a).toMatchObject({ idx: 0, startMs: 0, endMs: 1050 });
    expect(b).toMatchObject({ idx: 1, startMs: 1050, endMs: 2600 });
  });

  it("two own lines with no gap are cut at the junction", () => {
    const segs = [seg(0, 0, 1000, "A"), seg(1, 1000, 2000, "A")];
    const [a, b] = lineWindows(segs, 0, 1, "A", OPTS);
    expect(a.endMs).toBe(1000);
    expect(b.startMs).toBe(1000);
  });

  it("own lines far apart are not cut", () => {
    const segs = [seg(0, 0, 1000, "A"), seg(1, 5000, 6000, "A")];
    const [a, b] = lineWindows(segs, 0, 1, "A", OPTS);
    expect([a.startMs, a.endMs, b.startMs, b.endMs]).toEqual([0, 1600, 4700, 6600]);
  });

  it("only lines inside the clip produce windows, but neighbours outside the clip still clamp", () => {
    const segs = [seg(0, 0, 1000, "A"), seg(1, 1100, 2000, "A"), seg(2, 2200, 3000, "B")];
    const windows = lineWindows(segs, 1, 1, "A", OPTS);
    expect(windows.map((w) => w.idx)).toEqual([1]);
    expect(windows[0].startMs).toBe(800);
    expect(windows[0].endMs).toBe(2200);
  });

  it("unlabelled lines (speaker null) count as the other side", () => {
    const segs = [seg(0, 0, 1000, null), seg(1, 1100, 2000, "A")];
    expect(lineWindows(segs, 1, 1, "A", OPTS)[0].startMs).toBe(1000);
  });

  it("a clip with no own line has no windows", () => {
    const segs = [seg(0, 0, 1000, "B"), seg(1, 1000, 2000, "B")];
    expect(lineWindows(segs, 0, 1, "A", OPTS)).toEqual([]);
  });
});

describe("muteAt, countdownAt, phaseAt", () => {
  const windows = [
    { idx: 1, startMs: 4700, endMs: 6600, lineStartMs: 5000, lineEndMs: 6000 },
    { idx: 5, startMs: 12000, endMs: 14000, lineStartMs: 12300, lineEndMs: 13400 },
  ];

  it("the video is muted only inside a window (start included, end excluded)", () => {
    expect(muteAt(windows, 4699)).toBe(false);
    expect(muteAt(windows, 4700)).toBe(true);
    expect(muteAt(windows, 6599)).toBe(true);
    expect(muteAt(windows, 6600)).toBe(false);
  });

  it("the countdown shows 3, 2, 1 in the three seconds before the line and nothing after it starts", () => {
    expect(countdownAt(windows, 2000)).toBe(3);
    expect(countdownAt(windows, 2001)).toBe(3);
    expect(countdownAt(windows, 3000)).toBe(2);
    expect(countdownAt(windows, 4000)).toBe(1);
    expect(countdownAt(windows, 4999)).toBe(1);
    expect(countdownAt(windows, 5000)).toBeNull();
    expect(countdownAt(windows, 1999)).toBeNull();
  });

  it("phaseAt says mine while inside a window, and other with the next own line otherwise", () => {
    expect(phaseAt(windows, 5000)).toEqual({ kind: "mine", idx: 1 });
    expect(phaseAt(windows, 1000)).toEqual({ kind: "other", idx: 1 });
    expect(phaseAt(windows, 9000)).toEqual({ kind: "other", idx: 5 });
    expect(phaseAt(windows, 20000)).toEqual({ kind: "other", idx: -1 });
  });
});
