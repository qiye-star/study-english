/** 评测分数很低且评测听到的词与转写差别很大:可能混入了他人声音(R10,只提示,不阻断)。 */
export const MIXED_SCORE_MAX = 40;
export const MIXED_OVERLAP_MAX = 0.5;

const words = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);

export function wordOverlap(transcript: string, assessedWords: string[]): number {
  const said = words(transcript);
  if (!said.length) return 1;
  const heard = new Set(assessedWords.flatMap(words));
  return said.filter((w) => heard.has(w)).length / said.length;
}

export function mayHaveMixedVoices(score: number | null | undefined, transcript: string, assessedWords: string[]): boolean {
  return typeof score === "number" && Number.isFinite(score) && score < MIXED_SCORE_MAX && wordOverlap(transcript, assessedWords) < MIXED_OVERLAP_MAX;
}
