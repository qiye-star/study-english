/**
 * 分数刻度(design-notes):≥85 绿、70–84 琥珀、<70 次要灰。适用于所有分数(发音、流利、最近评分、平均发音);
 * 计数类(语法 1 处)不用它,保持中性。
 */
export type ScoreTone = "good" | "fair" | "low";

export function scoreTone(score: number): ScoreTone {
  if (score >= 85) return "good";
  if (score >= 70) return "fair";
  return "low";
}

const TEXT: Record<ScoreTone, string> = { good: "text-green", fair: "text-amber", low: "text-ink-2" };

/** 分数文字颜色类,如 <b className={cn("num", scoreToneClass(92))}>92</b>。 */
export function scoreToneClass(score: number): string {
  return TEXT[scoreTone(score)];
}

/** 对应的 ToneBadge 色调:good→green、fair→amber、low→gray。 */
export function scoreBadgeTone(score: number): "green" | "amber" | "gray" {
  return ({ good: "green", fair: "amber", low: "gray" } as const)[scoreTone(score)];
}
