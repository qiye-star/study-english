// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lookupMarks, srcOf } from "~/test/lookup-marks";

/** 计划 2026-10-15 清单 O1–O5(R-M5)。 */
const MARKS: Array<[file: string, atLeast: number]> = [
  ["features/library/analysis-card.tsx", 1],
  ["features/vocabulary/vocabulary-page.tsx", 1],
  ["features/progress/progress-page.tsx", 1],
  ["plugins/mistakes/mistakes-page.tsx", 1],
  ["plugins/pron-shadow/weak-words-page.tsx", 1],
];
describe("lookup marks: library, vocabulary, progress and plugins", () => {
  it.each(MARKS)("%s has at least %i marked elements", (file, n) => {
    expect(lookupMarks(srcOf(file))).toBeGreaterThanOrEqual(n);
  });
});
