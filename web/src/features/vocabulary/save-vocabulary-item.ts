import type { TFunction } from "i18next";
import { toast } from "sonner";
import type { ApiClient } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { normalizeSelection, type LookupResult } from "~/features/lookup/lookup";
import type { TextSelectionInfo } from "~/features/lookup/use-text-selection";
import {
  MAX_VOCAB_EXAMPLE, MAX_VOCAB_MEANING, MAX_VOCAB_WORD, VOCABULARY_SERVER_ERRORS, addVocabularyItem, clipCodePoints,
  type VocabularyInput,
} from "./vocabulary-api";

/** R19:查词结果 → 词条。释义 = 词性 · 母语释义 · 英文释义;例句 = 选区所在句。 */
export function vocabularyFromLookup(result: LookupResult, selection: TextSelectionInfo): VocabularyInput {
  const word = clipCodePoints(normalizeSelection(result.word || selection.text), MAX_VOCAB_WORD);
  const meaning = clipCodePoints([result.pos, result.translation, result.definition].map((s) => s.trim()).filter(Boolean).join(" · "), MAX_VOCAB_MEANING);
  const context = clipCodePoints(normalizeSelection(selection.context), MAX_VOCAB_EXAMPLE);
  return {
    word,
    meaning,
    example: context && context.toLowerCase() !== word.toLowerCase() ? context : undefined,
    source: "lookup",
  };
}

export async function saveVocabularyItem(api: ApiClient, t: TFunction, input: VocabularyInput): Promise<boolean> {
  try {
    await addVocabularyItem(api, input);
    toast.success(t("web.vocabulary.saved"));
    return true;
  } catch (err) {
    toast.error(translateServerError(t, err, VOCABULARY_SERVER_ERRORS));
    return false;
  }
}
