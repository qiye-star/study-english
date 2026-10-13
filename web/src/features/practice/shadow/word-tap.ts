import { scoreTone, type ScoreTone } from "~/components/score-tone";
import type { AssessmentWordBrief } from "../assessment-api";

/** 句子的一个片段:词(word = 从 0 起的词序号)或词之间的空白与标点(word = -1)。 */
export interface SentenceToken {
  text: string;
  word: number;
}

// 与 features/library/word-tap.ts 同一算法(R-S07:不能跨 feature 导入,所以本地一份)。
// 连字符 / 撇号只作词内连接符;归一化时去掉,"isn't" 能匹配评测返回的 "isnt"。
const TOKEN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const norm = (s: string) => s.toLowerCase().replace(/['’-]/g, "");

export function tokenizeSentence(text: string): SentenceToken[] {
  const out: SentenceToken[] = [];
  let cursor = 0;
  let n = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > cursor) out.push({ text: text.slice(cursor, start), word: -1 });
    out.push({ text: match[0], word: n });
    n += 1;
    cursor = start + match[0].length;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), word: -1 });
  return out;
}

function toneOf(w: AssessmentWordBrief): ScoreTone | null {
  if (w.errorType === "Mispronunciation" || w.errorType === "Omission") return "low";
  return typeof w.accuracyScore === "number" ? scoreTone(w.accuracyScore) : null;
}

/**
 * 把评测的逐词结果按顺序对齐到句子的词上(向前最多看 lookahead 个),返回每个词的分数色调(下标 = 词序号);
 * 对不上的词为 null。多说的词(Insertion)在句子里没有位置,不参与对齐。
 */
export function wordTones(tokens: SentenceToken[], words: AssessmentWordBrief[] | undefined, lookahead = 3): Array<ScoreTone | null> {
  const count = tokens.reduce((m, t) => Math.max(m, t.word + 1), 0);
  const tones: Array<ScoreTone | null> = new Array(count).fill(null);
  const scored = (words ?? []).filter((w) => w.errorType !== "Insertion" && w.word);
  let next = 0;
  for (const token of tokens) {
    if (token.word < 0) continue;
    const key = norm(token.text);
    for (let k = next; k < Math.min(scored.length, next + lookahead); k++) {
      if (norm(scored[k].word) === key) {
        tones[token.word] = toneOf(scored[k]);
        next = k + 1;
        break;
      }
    }
  }
  return tones;
}

/** 色调为 low 的词(句子里的原样写法,按出现顺序,忽略大小写去重,最多 limit 个)。 */
export function lowWords(tokens: SentenceToken[], tones: Array<ScoreTone | null>, limit = 3): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    if (token.word < 0 || tones[token.word] !== "low") continue;
    if (out.some((w) => w.toLowerCase() === token.text.toLowerCase())) continue;
    out.push(token.text);
    if (out.length >= limit) break;
  }
  return out;
}

export type TipKind = "good" | "fair" | "weak";

/** 提示条的种类只由色调决定:有弱词 → weak;否则按总分 good(≥85)/ fair。不编造发音建议(R-S14)。 */
export function tipFor(mainScore: number, low: string[]): { kind: TipKind; words: string[] } {
  if (low.length > 0) return { kind: "weak", words: low };
  return { kind: scoreTone(mainScore) === "good" ? "good" : "fair", words: [] };
}

/**
 * 点词 = 程序化选中这个词(R-S15):全局 LookupLayer 在 selectionchange 稳定 300 ms 后自己显示选词操作条,
 * 上下文取最近的 [data-lookup-context](整句)。用户刚拖选了别的文字时不覆盖。返回是否改了选区。
 */
export function selectWord(el: HTMLElement, doc: Document = el.ownerDocument): boolean {
  const sel = doc.getSelection();
  if (!sel) return false;
  const current = sel.isCollapsed ? "" : sel.toString().trim();
  if (current && current !== (el.textContent ?? "").trim()) return false;
  sel.removeAllRanges();
  sel.selectAllChildren(el);
  return true;
}
