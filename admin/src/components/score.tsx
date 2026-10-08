import { formatScore, scoreTone, TONE_BAR, TONE_SOFT, TONE_TEXT } from "../lib/format";

/** 小徽章:色点 + 标签 + 分数。颜色表示分数档位,文字不单独上色。 */
export function ScoreBadge({ score, label }: { score: number | null | undefined; label?: string }) {
  const tone = scoreTone(score);
  return (
    <span className={`chip num ${TONE_SOFT[tone]}`} title={label}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${TONE_BAR[tone]}`} />
      {label ? `${label} ` : ""}
      {formatScore(score)}
    </span>
  );
}

/** 大号总分:一页只放一个 */
export function ScoreHero({ score, label }: { score: number | null | undefined; label: string }) {
  const tone = scoreTone(score);
  return (
    <div className="flex flex-col">
      <span className="eyebrow">{label}</span>
      <span className={`num text-3xl font-semibold leading-none ${TONE_TEXT[tone]}`}>{formatScore(score)}</span>
    </div>
  );
}

/** 分数条:填充色表示档位,轨道是同色系更浅的一级 */
export function ScoreMeter({ label, score }: { label: string; score: number | null | undefined }) {
  const tone = scoreTone(score);
  const pct = Math.min(Math.max(score ?? 0, 0), 100);
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-12 shrink-0 text-muted">{label}</span>
      <div className={`h-1.5 flex-1 overflow-hidden rounded-full ${tone === "none" ? "bg-sunken" : TONE_SOFT[tone].split(" ")[0]}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className={`h-full rounded-full ${TONE_BAR[tone]} transition-[width] duration-500 ease-out`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`num w-7 text-right text-sm font-medium ${TONE_TEXT[tone]}`}>{formatScore(score)}</span>
    </div>
  );
}
