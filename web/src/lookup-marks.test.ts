// @vitest-environment node
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lookupMarks, srcOf } from "~/test/lookup-marks";

/**
 * 全站长按查词的总清单守卫(计划 2026-10-15-global-longpress-glass-lookup R-M5):分区清单在 lookup-marks.<lane>.test.ts;
 * 这里守总数、清单之外不得出现新标记文件、不标在按钮 / 链接上、答题前不可查(R-M3)、原有的 15 处仍在。
 */
const srcRoot = path.dirname(fileURLToPath(import.meta.url));
const posix = (p: string) => p.split(path.sep).join("/");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [posix(path.relative(srcRoot, full))] : [];
  });
}
const FILES = [...walk(path.join(srcRoot, "features")), ...walk(path.join(srcRoot, "plugins"))].filter((f) => !f.startsWith("features/lookup/"));

/** 计划之前就带标记的文件(原有的 15 处所在)。 */
const LEGACY = [
  "features/chat/message-bubble.tsx", "features/chat/hints-sheet.tsx", "features/chat/grammar-details.tsx", "features/chat/recap-sheet.tsx",
  "features/chat/sentence-practice-sheet.tsx", "features/chat/turn-detail-sheet.tsx", "features/library/shadow-panel.tsx",
  "features/practice/assessment-page.tsx", "features/practice/shadow/shadow-result.tsx", "features/practice/shadow/shadow-sheet.tsx",
  "features/realtime/call-captions.tsx", "features/vocabulary/review-card.tsx", "features/wordbook/choice-question.tsx",
];
/** 各分区守卫(lookup-marks.<lane>.test.ts)新增的文件。 */
const LANES = [
  "features/wordbook/word-card.tsx", "features/wordbook/defs-en.tsx", "features/wordbook/phrases-section.tsx", "features/wordbook/after-answer-panel.tsx",
  "features/wordbook/typing-question.tsx", "features/wordbook/session-summary.tsx", "features/wordbook/spell/spell-results.tsx", "features/wordbook/spell/explain-sheet.tsx",
  "features/agents/tutor/tutor-bar.tsx", "features/agents/tutor/tutor-recap-card.tsx", "features/agents/persona-editor-sheet.tsx",
  "features/rooms/room-message-list.tsx", "features/rooms/voice/voice-bubble.tsx", "features/rooms/assist/assist-dock.tsx", "features/rooms/assist/suggestion-card.tsx",
  "features/rooms/extras/summary-page.tsx", "features/rank/match-page.tsx", "features/rank/match-result.tsx",
  "features/library/analysis-card.tsx", "features/vocabulary/vocabulary-page.tsx", "features/progress/progress-page.tsx",
  "plugins/mistakes/mistakes-page.tsx", "plugins/pron-shadow/weak-words-page.tsx",
];
const LISTED = new Set([...LEGACY, ...LANES]);
/** 有英文内容但按设计不标(R-M3):答题前的题面。 */
const EXCLUDED = ["features/wordbook/recall-card.tsx", "features/wordbook/spell/cloze-board.tsx"];

describe("global lookup marks", () => {
  it("covers at least 60 English-content elements across features and plugins", () => {
    const total = FILES.reduce((sum, f) => sum + lookupMarks(srcOf(f)), 0);
    expect(total).toBeGreaterThanOrEqual(60);
  });
  it("keeps every context that existed before this plan", () => {
    for (const f of LEGACY) expect(lookupMarks(srcOf(f)), f).toBeGreaterThan(0);
  });
  it("marks every listed file, and no file outside the list or the exclusions", () => {
    for (const f of LISTED) expect(lookupMarks(srcOf(f)), f).toBeGreaterThan(0);
    const unlisted = FILES.filter((f) => lookupMarks(srcOf(f)) > 0 && !LISTED.has(f));
    expect(unlisted, "marked files missing from the central list").toEqual([]);
  });
  it("never puts a mark on a button, link or anchor opening tag (R-L2)", () => {
    for (const f of FILES) {
      for (const line of srcOf(f).split("\n")) {
        expect(/<(button|Link|a)\s[^>]*(\{\.\.\.lookupContext\}|lookupContextIf\(|data-lookup-context)/.test(line), `${f}: ${line.trim()}`).toBe(false);
      }
    }
  });
  it("never makes an unanswered prompt lookup-able (R-M3)", () => {
    for (const f of EXCLUDED) expect(lookupMarks(srcOf(f)), f).toBe(0);
    const choice = srcOf("features/wordbook/choice-question.tsx");
    expect(choice).toContain("lookupContextIf(result !== null)");
    expect(choice).toContain("marked={result !== null}");
    expect(srcOf("features/wordbook/word-card.tsx")).toContain("lookupContextIf(!covered)");
  });
});
