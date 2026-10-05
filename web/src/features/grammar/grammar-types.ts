export type GrammarCategory =
  | "tense" | "agreement" | "article" | "preposition" | "word_choice" | "word_order" | "plural" | "spelling" | "other";

export interface GrammarIssue {
  original: string;
  corrected: string;
  category: GrammarCategory;
  explanation: string;
}

/** 服务端 POST /api/ai/grammar 的规整结果(camelCase)。 */
export interface GrammarResult {
  hasErrors: boolean;
  corrected: string;
  errors: GrammarIssue[];
}
