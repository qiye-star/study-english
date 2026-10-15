// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lookupMarks, srcOf } from "~/test/lookup-marks";

/** 计划 2026-10-15 清单 S1–S18(R-M5)。 */
const MARKS: Array<[file: string, atLeast: number]> = [
  ["features/rooms/room-message-list.tsx", 4],
  ["features/rooms/voice/voice-bubble.tsx", 2],
  ["features/rooms/assist/assist-dock.tsx", 1],
  ["features/rooms/assist/suggestion-card.tsx", 1],
  ["features/rooms/extras/summary-page.tsx", 4],
  ["features/rank/match-page.tsx", 4],
  ["features/rank/match-result.tsx", 2],
];
describe("lookup marks: rooms and rank", () => {
  it.each(MARKS)("%s has at least %i marked elements", (file, n) => {
    expect(lookupMarks(srcOf(file))).toBeGreaterThanOrEqual(n);
  });
});
