// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lookupMarks, srcOf } from "~/test/lookup-marks";

/** 计划 2026-10-15 清单 C1–C7(R-M5)。 */
const MARKS: Array<[file: string, atLeast: number]> = [
  ["features/chat/grammar-details.tsx", 3],
  ["features/chat/recap-sheet.tsx", 3],
  ["features/chat/turn-detail-sheet.tsx", 2],
  ["features/agents/tutor/tutor-bar.tsx", 1],
  ["features/agents/tutor/tutor-recap-card.tsx", 1],
  ["features/agents/persona-editor-sheet.tsx", 1],
];
describe("lookup marks: chat and agents", () => {
  it.each(MARKS)("%s has at least %i marked elements", (file, n) => {
    expect(lookupMarks(srcOf(file))).toBeGreaterThanOrEqual(n);
  });
});
