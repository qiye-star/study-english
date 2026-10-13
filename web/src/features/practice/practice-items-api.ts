import type { ApiClient } from "~/api/client";
import type { Paged } from "~/api/types";

export type PracticeItemSource = "chat" | "lookup" | "grammar" | "manual" | "library";

export interface PracticeItem {
  id: string;
  text: string;
  source: PracticeItemSource;
  createdAt: string;
}

export const MAX_PRACTICE_TEXT = 2000;

export const PRACTICE_ITEM_SERVER_ERRORS: Record<string, string> = {
  "Practice item limit reached": "web.practice.list.errors.limit",
  "Practice item not found": "web.practice.list.errors.notFound",
};

export function listPracticeItems(api: ApiClient, page = 1, perPage = 50, signal?: AbortSignal): Promise<Paged<"practiceItems", PracticeItem>> {
  return api.request("GET", "/api/practice-items", { query: { page, per_page: perPage }, signal });
}

export function addPracticeItem(api: ApiClient, input: { text: string; source: PracticeItemSource }): Promise<PracticeItem> {
  return api.request("POST", "/api/practice-items", { json: { text: input.text.slice(0, MAX_PRACTICE_TEXT), source: input.source } });
}

export function deletePracticeItem(api: ApiClient, id: string, signal?: AbortSignal): Promise<{ id: string }> {
  return api.request("DELETE", `/api/practice-items/${encodeURIComponent(id)}`, { signal });
}
