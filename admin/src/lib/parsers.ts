/** 把后端透传的"不透明 JSON"规整成界面能读的形状;认不出就返回 null,由调用方回退到原始 JSON。 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pick = (o: Obj, ...keys: string[]): unknown => {
  for (const k of keys) if (k in o) return o[k];
  return undefined;
};

export interface GrammarIssue {
  original: string;
  corrected: string;
  category: string;
  explanation: string;
}

export interface GrammarNote {
  hasErrors: boolean;
  corrected: string;
  errors: GrammarIssue[];
}

/** 用户端存的是 {hasErrors, corrected, errors[]},也可能包了一层 {status, result} 或是 snake_case。 */
export function parseGrammar(raw: unknown): GrammarNote | null {
  if (!isObj(raw)) return null;
  const body = isObj(raw.result) ? raw.result : raw;
  const errorsRaw = pick(body, "errors");
  if (!Array.isArray(errorsRaw)) return null;
  const errors: GrammarIssue[] = [];
  for (const e of errorsRaw) {
    if (!isObj(e)) return null;
    errors.push({
      original: str(e.original),
      corrected: str(e.corrected),
      category: str(e.category) || "other",
      explanation: str(e.explanation),
    });
  }
  const flag = pick(body, "hasErrors", "has_errors");
  return {
    hasErrors: typeof flag === "boolean" ? flag : errors.length > 0,
    corrected: str(body.corrected),
    errors,
  };
}

export interface PhonemeScore {
  phoneme: string;
  score: number | null;
}

export interface WordScore {
  word: string;
  score: number | null;
  errorType: string;
  phonemes: PhonemeScore[];
}

function accuracy(o: unknown): number | null {
  if (!isObj(o)) return null;
  const pa = pick(o, "pronunciation_assessment", "pronunciationAssessment");
  return isObj(pa) ? num(pick(pa, "accuracy_score", "accuracyScore")) : null;
}

/** 评测 result 为 Azure 形状:detail_result.words[].pronunciation_assessment.accuracy_score。 */
export function parseWords(result: unknown): WordScore[] | null {
  if (!isObj(result)) return null;
  const detail = pick(result, "detail_result", "detailResult");
  const holder = isObj(detail) ? detail : result;
  const words = pick(holder, "words");
  if (!Array.isArray(words)) return null;
  const out: WordScore[] = [];
  for (const w of words) {
    if (!isObj(w) || typeof w.word !== "string") continue;
    const pa = pick(w, "pronunciation_assessment", "pronunciationAssessment");
    const phonemesRaw = pick(w, "phonemes");
    out.push({
      word: w.word,
      score: accuracy(w),
      errorType: isObj(pa) ? str(pick(pa, "error_type", "errorType")) || "None" : "None",
      phonemes: Array.isArray(phonemesRaw)
        ? phonemesRaw.filter(isObj).map((p) => ({ phoneme: str(p.phoneme), score: accuracy(p) }))
        : [],
    });
  }
  return out.length ? out : null;
}
