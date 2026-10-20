import type { TFunction } from "i18next";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import type { ApiClient } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { MAX_PRACTICE_TEXT, PRACTICE_ITEM_SERVER_ERRORS, addPracticeItem, type PracticeItemSource } from "./practice-items-api";

export function practiceReference(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_PRACTICE_TEXT);
}

/** 跳到跟读页(/practice/shadow)并预填参考文本(跟读页从路由 state 读取 reference)。 */
export function goPractice(navigate: NavigateFunction, text: string): void {
  navigate("/practice/shadow", { state: { reference: practiceReference(text) } });
}

export async function savePracticeItem(api: ApiClient, t: TFunction, text: string, source: PracticeItemSource): Promise<boolean> {
  try {
    await addPracticeItem(api, { text: practiceReference(text), source });
    toast.success(t("web.practice.list.saved"));
    return true;
  } catch (err) {
    toast.error(translateServerError(t, err, PRACTICE_ITEM_SERVER_ERRORS));
    return false;
  }
}
