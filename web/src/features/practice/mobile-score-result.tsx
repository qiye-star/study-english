import { useTranslation } from "react-i18next";
import { scoreTone, type ScoreTone } from "~/components/score-tone";
import type { AssessmentScores } from "./assessment-api";

const STROKE: Record<ScoreTone, string> = { good: "stroke-green", fair: "stroke-amber", low: "stroke-ink-3" };
const FILL: Record<ScoreTone, string> = { good: "bg-green", fair: "bg-amber", low: "bg-ink-3" };
const TEXT: Record<ScoreTone, string> = { good: "text-green", fair: "text-amber", low: "text-ink-2" };

const R = 54;
const C = 2 * Math.PI * R;

/** 手机端评分视图:语义分数刻度(≥85 绿 / 70–84 琥珀 / <70 灰)的圆环 + 三条横条,不依赖桌面组件。 */
export function MobileScoreResult({ scores }: { scores: AssessmentScores }) {
  const { t } = useTranslation();
  const main = Math.max(0, Math.min(100, scores.pronunciationScore || 0));
  const tone = scoreTone(main);
  const bars: Array<[string, number]> = [
    [t("models.pronunciationAssessment.accuracyScore"), scores.accuracyScore],
    [t("models.pronunciationAssessment.fluencyScore"), scores.fluencyScore],
    [t("models.pronunciationAssessment.completenessScore"), scores.completenessScore],
  ];
  return (
    <div data-testid="assessment-scores" className="space-y-4">
      <div className="flex flex-col items-center gap-2">
        <div className="text-sub text-ink-2">{t("pronunciationAssessment")}</div>
        <div className="relative h-32 w-32">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="60" cy="60" r={R} fill="none" strokeWidth="9" className="stroke-surface-2 liquid:stroke-wash-2" />
            <circle cx="60" cy="60" r={R} fill="none" strokeWidth="9" strokeLinecap="round" className={`${STROKE[tone]} liquid:stroke-ink`}
              strokeDasharray={C} strokeDashoffset={C * (1 - main / 100)} />
          </svg>
          <span className={`num absolute inset-0 flex items-center justify-center text-[32px] font-semibold ${TEXT[tone]} liquid:text-ink`}>
            {scores.pronunciationScore}
          </span>
        </div>
        <div className="flex items-center gap-4 text-meta text-ink-2">
          <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-green liquid:size-1.5 liquid:rounded-full" />≥85</span>
          <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-amber liquid:size-1.5 liquid:rounded-full" />70–84</span>
          <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-ink-3 liquid:size-1.5 liquid:rounded-full" />&lt;70</span>
        </div>
      </div>
      <div className="space-y-3">
        {bars.map(([label, score]) => {
          const bt = scoreTone(score || 0);
          return (
            <div key={label}>
              <div className="mb-1.5 flex items-center justify-between text-sub">
                <span className="text-ink">{label}</span>
                <span className={`num font-semibold ${TEXT[bt]} liquid:text-ink`}>{score}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2 liquid:bg-wash-2">
                <div className={`h-full rounded-full ${FILL[bt]} liquid:bg-ink/85`} style={{ width: `${Math.max(0, Math.min(100, score || 0))}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
