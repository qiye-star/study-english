import { LANGUAGES } from "@/constants";
import { completeChat } from "~/api/ai";
import { ApiError, type ApiClient } from "~/api/client";
import { inflightDedupe, withSignal } from "~/lib/abortable";
import { kvGet, kvSet } from "~/lib/kv-cache";
import { extractJsonObject } from "~/lib/model-json";
import { DICTIONARY_PROMPT, TRANSLATION_PROMPT, TRANSLATION_SYSTEM_PROMPT, renderTemplate } from "./prompts";

export type LookupMode = "lookup" | "translate";

export interface LookupResult {
  word: string;
  lemma: string;
  pronunciation: string;
  pos: string;
  definition: string;
  translation: string;
  contextTranslation: string;
}

export const LEARNING_LANGUAGE = "en-US";
const MAX_TEXT = 1000;

export function normalizeSelection(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function classifySelection(text: string): LookupMode | null {
  const normalized = normalizeSelection(text);
  if (!normalized) return null;
  return normalized.split(" ").length <= 3 && normalized.length <= 40 ? "lookup" : "translate";
}

export function languageName(code: string): string {
  return (LANGUAGES as Array<{ code: string; name: string }>).find((l) => l.code === code)?.name ?? code;
}

function invalid(): never {
  throw new ApiError(502, "Invalid dictionary response");
}

/** Parse the model's JSON defensively: code fences, surrounding prose, missing or non-string fields. */
export function parseLookupJson(raw: string): LookupResult {
  const data = extractJsonObject(raw);
  if (!data) invalid();
  const field = (key: string) => (typeof data![key] === "string" ? (data![key] as string).trim() : "");
  return {
    word: field("word"),
    lemma: field("lemma"),
    pronunciation: field("pronunciation"),
    pos: field("pos"),
    definition: field("definition"),
    translation: field("translation"),
    contextTranslation: field("context_translation"),
  };
}

export async function lookupWord(
  api: ApiClient,
  { word, context, nativeLanguage }: { word: string; context: string; nativeLanguage: string },
  signal?: AbortSignal,
): Promise<LookupResult> {
  const system = renderTemplate(DICTIONARY_PROMPT, {
    learning_language: languageName(LEARNING_LANGUAGE),
    native_language: languageName(nativeLanguage),
  });
  const raw = await completeChat(
    api,
    {
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ word, context }) }],
      temperature: 0,
      jsonMode: true,
    },
    signal,
  );
  return parseLookupJson(raw);
}

export async function translateText(
  api: ApiClient,
  { text, nativeLanguage }: { text: string; nativeLanguage: string },
  signal?: AbortSignal,
): Promise<string> {
  const prompt = renderTemplate(TRANSLATION_PROMPT, { native_language: languageName(nativeLanguage), text });
  const out = await completeChat(
    api,
    { messages: [{ role: "system", content: TRANSLATION_SYSTEM_PROMPT }, { role: "user", content: prompt }], temperature: 0 },
    signal,
  );
  return out.trim();
}

// JSON-encoded tuples so ":" inside text can never make two different requests share a key.
export const lookupCacheKey = (word: string, context: string, native: string) =>
  `lookup:v1:${JSON.stringify([native, normalizeSelection(word).toLowerCase(), normalizeSelection(context)])}`;
export const translateCacheKey = (text: string, native: string) =>
  `translate:v1:${JSON.stringify([native, normalizeSelection(text)])}`;

const dedupe = inflightDedupe<unknown>();

export function cachedLookup(
  api: ApiClient,
  params: { word: string; context: string; nativeLanguage: string },
  signal?: AbortSignal,
): Promise<LookupResult> {
  const word = normalizeSelection(params.word).slice(0, MAX_TEXT);
  const context = normalizeSelection(params.context).slice(0, MAX_TEXT);
  const key = lookupCacheKey(word, context, params.nativeLanguage);
  return withSignal(
    dedupe(key, async () => {
      const hit = await kvGet<LookupResult>(key);
      if (hit) return hit;
      const result = await lookupWord(api, { word, context, nativeLanguage: params.nativeLanguage });
      if (result.definition || result.translation) await kvSet(key, result); // don't pin "unknown" answers
      return result;
    }) as Promise<LookupResult>,
    signal,
  );
}

export function cachedTranslate(
  api: ApiClient,
  params: { text: string; nativeLanguage: string },
  signal?: AbortSignal,
): Promise<string> {
  const text = normalizeSelection(params.text).slice(0, MAX_TEXT);
  const key = translateCacheKey(text, params.nativeLanguage);
  return withSignal(
    dedupe(key, async () => {
      const hit = await kvGet<string>(key);
      if (hit) return hit;
      const result = await translateText(api, { text, nativeLanguage: params.nativeLanguage });
      if (result) await kvSet(key, result);
      return result;
    }) as Promise<string>,
    signal,
  );
}

export const LOOKUP_SERVER_ERRORS: Record<string, string> = {
  "Invalid dictionary response": "web.lookup.invalid",
  "Empty AI response": "web.lookup.invalid",
  "Upstream unavailable": "web.lookup.upstream",
  "LLM upstream is not configured": "web.lookup.notConfigured",
};
