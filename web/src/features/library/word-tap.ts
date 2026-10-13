import { useSyncExternalStore } from "react";
import { scoreTone, type ScoreTone } from "~/components/score-tone";

/** 句子的一个片段:词(word = 从 0 起的词序号)或词之间的空白与标点(word = -1)。 */
export interface SentenceToken {
  text: string;
  word: number;
}

/** 评测的逐词结果(与 ~/features/practice 的 AssessmentWordBrief 同形;这里不导入 practice)。 */
export interface WordScore {
  word: string;
  accuracyScore: number | null;
  errorType: string | null;
}

// 连字符 / 撇号只作词内连接符(与对话转写的对齐同一写法);归一化时去掉,"isn't" 能匹配评测返回的 "isnt"。
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

function toneOf(w: WordScore): ScoreTone | null {
  if (w.errorType === "Mispronunciation" || w.errorType === "Omission") return "low";
  return typeof w.accuracyScore === "number" ? scoreTone(w.accuracyScore) : null;
}

/**
 * 把评测的逐词结果按顺序对齐到句子的词上(向前最多看 lookahead 个),返回每个词的分数色调(下标 = 词序号);
 * 对不上的词为 null。多说的词(Insertion)在句子里没有位置,不参与对齐(plan W2 R-SH09)。
 */
export function wordTones(tokens: SentenceToken[], words: WordScore[] | undefined, lookahead = 3): Array<ScoreTone | null> {
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

/**
 * 点词 = 程序化选中这个词(plan W2 R-SH15):全局 LookupLayer 在 selectionchange 稳定 300 ms 后自己打开,上下文取
 * 最近的 [data-lookup-context](整句)。用户刚拖选了别的文字时不覆盖。返回是否改了选区。
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

// ---- 评分词色 store(R-SH31) ----
// ShadowPanel(评分)与 SegmentText(显示句子)是 W1 在同一行里渲染的两个互不嵌套的组件;「刚评过的那一句的逐词结果」经这个模块级小 store 共享。
// 只保留一条:换句 / 卸载时由 ShadowPanel 清掉自己的那条(clearWordScores 只清 idx 与文字都相同的条目)。
interface ScoredSentence {
  idx: number;
  text: string;
  words: WordScore[];
}
let current: ScoredSentence | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of [...listeners]) listener();
};

export function publishWordScores(idx: number, text: string, words: WordScore[]): void {
  current = { idx, text, words };
  emit();
}

export function clearWordScores(idx: number, text: string): void {
  if (current && current.idx === idx && current.text === text) {
    current = null;
    emit();
  }
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** 这一句刚评过的逐词结果;不是这一句(或文字已改)返回 null。快照是稳定引用,useSyncExternalStore 不会无限重渲。 */
export function useScoredWords(idx: number, text: string): WordScore[] | null {
  return useSyncExternalStore(
    subscribe,
    () => (current && current.idx === idx && current.text === text ? current.words : null),
    (): WordScore[] | null => null,
  );
}
