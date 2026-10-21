/**
 * 字幕逐词高亮的线性估计(计划 L5 W9)。库的句子没有逐词时间下发到网页,所以按字母数把句子时长分给各词:
 * 这是估计,不是真实的词时间;语速变化大的句子会提前或滞后。纯函数。
 */

export interface WordSpan {
  word: string;
  startMs: number;
  endMs: number;
}

export type WordState = "past" | "active" | "future";

const weightOf = (word: string): number => Math.max(1, word.replace(/[^\p{L}\p{N}]/gu, "").length);

export function estimateWordTimes(words: readonly string[], startMs: number, endMs: number): WordSpan[] {
  if (words.length === 0) return [];
  const end = Math.max(startMs, endMs);
  const span = end - startMs;
  const weights = words.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);
  let at = startMs;
  return words.map((word, i) => {
    const from = at;
    at += (span * weights[i]) / total;
    return { word, startMs: Math.round(from), endMs: Math.round(i === words.length - 1 ? end : at) };
  });
}

/** ms 落在哪个词的时段里;不在任何词里为 -1。 */
export function activeWordAt(spans: readonly WordSpan[], ms: number): number {
  return spans.findIndex((s) => ms >= s.startMs && ms < s.endMs);
}

/** 每个词的状态。减少动态效果时整句一次点亮(开始后全部 active)。 */
export function wordStates(spans: readonly WordSpan[], ms: number, reducedMotion: boolean): WordState[] {
  if (reducedMotion) {
    const started = spans.length > 0 && ms >= spans[0].startMs;
    return spans.map(() => (started ? "active" : "future"));
  }
  const now = activeWordAt(spans, ms);
  if (now === -1) return spans.map((s) => (ms >= s.endMs ? "past" : "future"));
  return spans.map((_, i) => {
    if (i < now) return "past";
    if (i === now) return "active";
    return "future";
  });
}
