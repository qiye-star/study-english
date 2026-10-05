import type { AssessmentWordBrief } from "~/features/practice/assessment-api";

export const POOR_ACCURACY = 60;

export function isPoorWord(w: AssessmentWordBrief): boolean {
  if (w.errorType === "Insertion") return false; // 多说的词:转写里没有对应位置
  if (w.errorType === "Mispronunciation" || w.errorType === "Omission") return true;
  return typeof w.accuracyScore === "number" && w.accuracyScore < POOR_ACCURACY;
}

export interface TranscriptPiece {
  text: string;
  poor: boolean;
}

const TOKEN = /[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g;
const norm = (s: string) => s.toLowerCase().replace(/['’]/g, "");

/** 把评测的逐词结果按顺序对齐到转写文本上(向前最多看 3 个词),标出读得差的词;对不上的词不标。 */
export function markTranscript(text: string, words: AssessmentWordBrief[] | undefined, lookahead = 3): TranscriptPiece[] {
  const scored = (words ?? []).filter((w) => w.errorType !== "Insertion" && w.word);
  const pieces: TranscriptPiece[] = [];
  const pushPiece = (piece: string, poor: boolean) => {
    if (!piece) return;
    const last = pieces[pieces.length - 1];
    if (last && !last.poor && !poor) last.text += piece;
    else pieces.push({ text: piece, poor });
  };
  let cursor = 0;
  let next = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    const token = norm(match[0]);
    let poor = false;
    for (let k = next; k < Math.min(scored.length, next + lookahead); k++) {
      if (norm(scored[k].word) === token) {
        poor = isPoorWord(scored[k]);
        next = k + 1;
        break;
      }
    }
    pushPiece(text.slice(cursor, start), false);
    pushPiece(match[0], poor);
    cursor = start + match[0].length;
  }
  pushPiece(text.slice(cursor), false);
  return pieces.length ? pieces : [{ text, poor: false }];
}

export function poorWords(words: AssessmentWordBrief[] | undefined, max = 5): string[] {
  const out: string[] = [];
  for (const w of words ?? []) {
    const word = w.word.toLowerCase();
    if (isPoorWord(w) && word && !out.includes(word)) out.push(word);
    if (out.length === max) break;
  }
  return out;
}
