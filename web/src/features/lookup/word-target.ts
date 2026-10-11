import { MAX_WORD_TARGET, type WordTarget } from "~/lib/extension-points";
import { normalizeSelection, type LookupResult } from "./lookup";
import type { TextSelectionInfo } from "./use-text-selection";

const clip = (text: string, max: number): string => {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join("");
};

/** R19:查词结果 → 单词目标。释义 = 词性 · 母语释义 · 英文释义;例句 = 选区所在句(原 vocabulary 的 vocabularyFromLookup,逐项相同)。 */
export function wordTargetFromLookup(result: LookupResult, selection: TextSelectionInfo): WordTarget {
  const word = clip(normalizeSelection(result.word || selection.text), MAX_WORD_TARGET.word);
  const meaning = clip([result.pos, result.translation, result.definition].map((s) => s.trim()).filter(Boolean).join(" · "),
    MAX_WORD_TARGET.meaning);
  const context = clip(normalizeSelection(selection.context), MAX_WORD_TARGET.example);
  return { word, meaning, example: context && context.toLowerCase() !== word.toLowerCase() ? context : undefined, source: "lookup" };
}
