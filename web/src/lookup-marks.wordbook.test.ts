// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lookupMarks, srcOf } from "~/test/lookup-marks";

/** 计划 2026-10-15-global-longpress-glass-lookup 清单 W1–W15(R-M5):背单词里的英文学习内容带查词标记;答题前的题面不带(R-M3)。 */
const MARKS: Array<[file: string, atLeast: number]> = [
  ["features/wordbook/word-card.tsx", 4],
  ["features/wordbook/defs-en.tsx", 1],
  ["features/wordbook/phrases-section.tsx", 2],
  ["features/wordbook/after-answer-panel.tsx", 1],
  ["features/wordbook/choice-question.tsx", 3],
  ["features/wordbook/typing-question.tsx", 1],
  ["features/wordbook/session-summary.tsx", 1],
  ["features/wordbook/spell/spell-results.tsx", 2],
  ["features/wordbook/spell/explain-sheet.tsx", 1],
  // 单词拼写(plan 2026-10-27 R-W7):只有答后的正确拼写可查词;答前的题面、偷看牌子与输入区不带
  ["features/wordbook/word-spell/word-spell-question.tsx", 1],
];

describe("lookup marks: wordbook", () => {
  it.each(MARKS)("%s has at least %i marked elements", (file, n) => {
    expect(lookupMarks(srcOf(file))).toBeGreaterThanOrEqual(n);
  });
  it("never marks text before an answer or a reveal", () => {
    expect(lookupMarks(srcOf("features/wordbook/recall-card.tsx"))).toBe(0);
    expect(lookupMarks(srcOf("features/wordbook/spell/cloze-board.tsx"))).toBe(0);
  });
});
