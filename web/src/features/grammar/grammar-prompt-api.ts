import type { ApiClient } from "~/api/client";

export interface GrammarPromptState {
  prompt: string | null;
  defaultPrompt: string;
  maxLength: number;
}

export const GRAMMAR_PROMPT_SERVER_ERRORS: Record<string, string> = {
  "prompt: String should have at most 2000 characters": "web.grammarPrompt.errors.tooLong",
};

const PATH = "/api/me/grammar-prompt";

export function getGrammarPrompt(api: ApiClient, signal?: AbortSignal): Promise<GrammarPromptState> {
  return api.request("GET", PATH, { signal });
}

export function saveGrammarPrompt(api: ApiClient, prompt: string): Promise<GrammarPromptState> {
  return api.request("PUT", PATH, { json: { prompt } });
}

export function resetGrammarPrompt(api: ApiClient): Promise<GrammarPromptState> {
  return api.request("DELETE", PATH);
}
