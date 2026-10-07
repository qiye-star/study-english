import { useId } from "react";
import type { StatsDay } from "./stats-api";

const W = 300;
const H = 120;
const PAD = 8;

export type ChartPoint = { x: number; y: number };

/** 每日平均发音分 → 折线段(没有分数的日子断开)。纯函数,便于测试。 */
export function chartSegments(daily: StatsDay[], width: number, height: number, pad: number): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  const span = width - 2 * pad;
  daily.forEach((d, i) => {
    if (d.avgPronunciation === null || !Number.isFinite(d.avgPronunciation)) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    const score = Math.min(100, Math.max(0, d.avgPronunciation));
    const x = pad + (daily.length === 1 ? span / 2 : (i * span) / (daily.length - 1));
    const y = pad + ((100 - score) * (height - 2 * pad)) / 100;
    current.push({ x, y });
  });
  if (current.length) segments.push(current);
  return segments;
}

/**
 * 内联 SVG 折线图(不引入图表库)。SVG 本身带 title/desc;逐日数值的文字替代由调用方以列表给出。
 */
export function ScoreChart({ daily, label, description }: { daily: StatsDay[]; label: string; description?: string }) {
  const id = useId();
  const segments = chartSegments(daily, W, H, PAD);
  const points = segments.reduce((n, s) => n + s.length, 0);
  const guide = (score: number) => PAD + ((100 - score) * (H - 2 * PAD)) / 100;
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  return (
    <svg data-testid="progress-chart" data-points={points} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}
      aria-describedby={description ? descId : undefined} className="h-32 w-full text-blue" preserveAspectRatio="none">
      <title id={titleId}>{label}</title>
      {description && <desc id={descId}>{description}</desc>}
      {[60, 80].map((s) => (
        <line key={s} x1={PAD} x2={W - PAD} y1={guide(s)} y2={guide(s)} className="stroke-ink-3/40" strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke" />
      ))}
      {segments.map((seg, i) => (
        seg.length > 1
          ? <polyline key={i} points={seg.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={2}
            vectorEffect="non-scaling-stroke" />
          : null
      ))}
      {/* 零长度线段 + 圆端点画点:配合 non-scaling-stroke,拉伸后仍是圆点(circle 会被拉成椭圆) */}
      {segments.flat().map((p, i) => (
        <line key={`p${i}`} x1={p.x} y1={p.y} x2={p.x} y2={p.y} stroke="currentColor" strokeWidth={6} strokeLinecap="round"
          vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
