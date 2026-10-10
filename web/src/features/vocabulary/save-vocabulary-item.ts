import type { TFunction } from "i18next";
import { toast } from "sonner";
import type { ApiClient } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { VOCABULARY_SERVER_ERRORS, addVocabularyItem, type VocabularyInput, type VocabularyItem } from "./vocabulary-api";

/** 服务端遇到同词直接返回已有词条(同样 200)。只凭确凿迹象判为"已有":复习过,或创建时间明显早于本次请求(留足时钟偏差)。 */
const EXISTING_SLACK_MS = 10 * 60 * 1000;
export function isExistingVocabularyItem(item: Partial<VocabularyItem> | null | undefined, startedAt: number): boolean {
  if (!item) return false;
  if ((typeof item.reps === "number" && item.reps > 0) || item.lastReviewedAt) return true;
  const created = item.createdAt ? Date.parse(item.createdAt) : NaN;
  return Number.isFinite(created) && created < startedAt - EXISTING_SLACK_MS;
}

export async function saveVocabularyItem(api: ApiClient, t: TFunction, input: VocabularyInput): Promise<boolean> {
  try {
    const startedAt = Date.now();
    const item = await addVocabularyItem(api, input);
    toast.success(t(isExistingVocabularyItem(item, startedAt) ? "web.vocabulary.alreadySaved" : "web.vocabulary.saved"));
    return true;
  } catch (err) {
    toast.error(translateServerError(t, err, VOCABULARY_SERVER_ERRORS));
    return false;
  }
}
