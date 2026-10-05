/** 是否值得做英文评测/语法检查(计划裁定 R5)。只区分拉丁与非拉丁文字。 */
export type Checkability = { ok: true } | { ok: false; reason: "empty" | "non-english" | "too-short" };

export const MIN_LATIN_RATIO = 0.8;
export const MIN_GRAMMAR_WORDS = 3;

const LETTER = /\p{L}/gu;
const LATIN = /\p{Script=Latin}/gu;
const ENGLISH_WORD = /\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*/gu;

/** 注意:超过 2000 字符不评测的限制由调用方(Task 3.3)负责,此处不检查长度。 */
export function checkability(rawText: string): Checkability {
  const text = rawText.normalize("NFC"); // NFD 的组合重音不属于 Latin 文字,会把单词拆开
  const letters = text.match(LETTER)?.length ?? 0;
  if (!letters) return { ok: false, reason: "empty" };
  const latin = text.match(LATIN)?.length ?? 0;
  if (latin / letters < MIN_LATIN_RATIO) return { ok: false, reason: "non-english" };
  if ((text.match(ENGLISH_WORD)?.length ?? 0) < MIN_GRAMMAR_WORDS) return { ok: false, reason: "too-short" };
  return { ok: true };
}

/** 发音评测:有英文就评(1–2 个词也评);非英文或没有文字则跳过。 */
export function isAssessable(text: string): boolean {
  const check = checkability(text);
  return !("reason" in check) || check.reason === "too-short";
}
