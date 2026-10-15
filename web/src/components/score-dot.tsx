import { cn } from "@renderer/lib/utils";
import { scoreTone } from "./score-tone";

/** 分数点(设计稿 .dot.g / .dot.a):≥85 绿、70–84 琥珀、<70 不画。分数数字本身用墨色(计划 2026-10-15-liquid-glass R-LG10)。 */
export function scoreDotClass(score: number): "bg-green" | "bg-amber" | null {
  const tone = scoreTone(score);
  return tone === "good" ? "bg-green" : tone === "fair" ? "bg-amber" : null;
}

/** 6px 圆点,只在液态皮肤下显示(经典皮肤保持原来的彩色数字)。 */
export function ScoreDot({ score, className }: { score: number; className?: string }) {
  const dot = scoreDotClass(score);
  if (!dot) return null;
  return <i aria-hidden data-score-dot className={cn("hidden size-1.5 flex-none rounded-full liquid:inline-block", dot, className)} />;
}
