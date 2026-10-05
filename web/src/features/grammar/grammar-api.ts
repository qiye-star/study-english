import { ApiError, type ApiClient } from "~/api/client";
import { kvGet, kvSet } from "~/lib/kv-cache";
import { readJson, writeJson } from "~/lib/storage";
import type { GrammarCategory, GrammarIssue, GrammarResult } from "./grammar-types";

export const GRAMMAR_REV_KEY = "enjoy-web.grammar.rev";
export const MAX_GRAMMAR_CONTEXT = 500;
export const MAX_GRAMMAR_TEXT = 2000;

export const GRAMMAR_SERVER_ERRORS: Record<string, string> = {
  "Grammar upstream is not configured": "web.grammar.errors.notConfigured",
  "Text is required": "web.grammar.errors.empty",
  "Text is too long": "web.grammar.errors.tooLong",
  "Upstream unavailable": "web.grammar.errors.upstream",
  "Upstream authentication failed": "web.grammar.errors.upstream",
  "Too many requests, please try again later": "web.grammar.errors.rateLimit",
};

const CATEGORIES: readonly GrammarCategory[] = [
  "tense", "agreement", "article", "preposition", "word_choice", "word_order", "plural", "spelling", "other",
];

const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** 本机的提示词版本号(R15):保存/恢复提示词后 +1,旧缓存自然失效。 */
export function grammarRev(): number {
  return readJson(GRAMMAR_REV_KEY, isCount) ?? 0;
}

export function bumpGrammarRev(): void {
  writeJson(GRAMMAR_REV_KEY, grammarRev() + 1);
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
}

export function grammarCacheKey(text: string, rev = grammarRev(), context = ""): string {
  const ctx = normalize(context).slice(-MAX_GRAMMAR_CONTEXT);
  return `grammar:v1:${rev}:${JSON.stringify(normalize(text))}${ctx ? `:${hash(ctx)}` : ""}`;
}

function malformed(): never {
  throw new ApiError(502, "Upstream unavailable");
}

function parseResult(data: unknown): GrammarResult {
  if (!data || typeof data !== "object") return malformed();
  const d = data as Record<string, unknown>;
  if (typeof d.hasErrors !== "boolean" || typeof d.corrected !== "string" || !Array.isArray(d.errors)) return malformed();
  const errors: GrammarIssue[] = d.errors.map((e) => {
    if (!e || typeof e !== "object") return malformed();
    const i = e as Record<string, unknown>;
    if (typeof i.original !== "string" || typeof i.corrected !== "string") return malformed();
    const category = CATEGORIES.includes(i.category as GrammarCategory) ? (i.category as GrammarCategory) : "other";
    return { original: i.original, corrected: i.corrected, category, explanation: typeof i.explanation === "string" ? i.explanation : "" };
  });
  return { hasErrors: d.hasErrors, corrected: d.corrected, errors };
}

function validateText(text: string): void {
  if (!text) throw new ApiError(400, "Text is required");
  if (text.length > MAX_GRAMMAR_TEXT) throw new ApiError(413, "Text is too long");
}

export async function checkGrammar(
  api: ApiClient,
  params: { text: string; context?: string },
  signal?: AbortSignal,
): Promise<GrammarResult> {
  validateText(params.text.trim());
  const context = params.context?.trim().slice(-MAX_GRAMMAR_CONTEXT);
  const data = await api.request<unknown>("POST", "/api/ai/grammar", {
    json: context ? { text: params.text, context } : { text: params.text },
    signal,
    timeoutMs: 120_000,
  });
  return parseResult(data);
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

/** Each caller can abort its own wait; the shared request keeps running for the others. */
function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

const inflight = new Map<string, Promise<GrammarResult>>();

/** 同一文本(同一提示词版本)只查一次;失败不缓存;并发相同请求共享一次调用。 */
export function cachedGrammar(
  api: ApiClient,
  params: { text: string; context?: string },
  signal?: AbortSignal,
): Promise<GrammarResult> {
  try {
    validateText(params.text.trim());
  } catch (err) {
    return Promise.reject(err);
  }
  const key = grammarCacheKey(params.text, grammarRev(), params.context);
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const hit = await kvGet<unknown>(key);
      if (hit) {
        try {
          return parseResult(hit);
        } catch {
          /* corrupt cache entry: refetch */
        }
      }
      const result = await checkGrammar(api, params);
      await kvSet(key, result);
      return result;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return withSignal(p, signal);
}
