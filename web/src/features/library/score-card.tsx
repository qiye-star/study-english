import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { scoreTone, scoreToneClass, type ScoreTone } from "~/components/score-tone";
import type { AssessmentScores } from "~/features/practice";
import { SaveSentenceChip, type SaveSentenceState } from "./save-sentence";
import "./locales";
import { CountUp, GlassSurface, GradientText } from "./shadow-fx";

const R = 30;
const C = 2 * Math.PI * R;
const STROKE: Record<ScoreTone, string> = { good: "stroke-green", fair: "stroke-amber", low: "stroke-ink-3" };
const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

export interface ScoreCardProps {
  scores: AssessmentScores;
  /** POST attempts 是否成功;失败时只说一句,分数照常显示(R-SH14) */
  attemptSaved: boolean;
  save: SaveSentenceState;
}

/**
 * 一次跟读的评分卡(设计稿 D,spec §11.4a):评分环从 0 转到分数 + 数字滚动(CountUp),评语 ≥ 85 用渐变字(GradientText),
 * 三项子分,「加入练习」芯片(ClickSpark)。每次评分重新挂载(调用方以 assessmentId 作 key),所以动画每次都从 0 开始;
 * 减少动态效果时环直接到位、数字直接是终值(CountUp 自己处理,环用 motion-reduce:transition-none)。
 */
export function ScoreCard({ scores, attemptSaved, save }: ScoreCardProps) {
  const { t } = useTranslation();
  const main = clamp(scores.pronunciationScore);
  const tone = scoreTone(main);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") {
      setReady(true);
      return undefined;
    }
    const id = requestAnimationFrame(() => setReady(true)); // 先以 0 画一帧,再过渡到目标值
    return () => cancelAnimationFrame(id);
  }, []);
  const headline = t(`web.library.shadow.score.${tone}`);
  const stats = [
    ["accuracyScore", scores.accuracyScore],
    ["fluencyScore", scores.fluencyScore],
    ["completenessScore", scores.completenessScore],
  ] as const;

  return (
    <GlassSurface tint data-testid="assessment-scores" data-tone={tone} className="p-3.5">
      <div className="flex items-center gap-3.5">
        <div className="relative h-[72px] w-[72px] flex-none">
          <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="36" cy="36" r={R} fill="none" strokeWidth="6" className="stroke-hair" />
            <circle
              data-testid="score-ring-arc" cx="36" cy="36" r={R} fill="none" strokeWidth="6" strokeLinecap="round"
              className={cn(STROKE[tone], "transition-[stroke-dashoffset] duration-1000 ease-standard motion-reduce:transition-none")}
              strokeDasharray={C} strokeDashoffset={ready ? C * (1 - main / 100) : C}
            />
          </svg>
          <span data-testid="score-main" className={cn("absolute inset-0 flex items-center justify-center text-[22px] font-semibold", scoreToneClass(main))}>
            <CountUp to={main} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div data-testid="score-headline" className="text-title font-semibold">
            {tone === "good" ? <GradientText>{headline}</GradientText> : <span className={scoreToneClass(main)}>{headline}</span>}
          </div>
          <div className="mt-1 text-meta text-ink-2">{t("pronunciationAssessment")}</div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {stats.map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="truncate text-meta text-ink-2">{t(`models.pronunciationAssessment.${key}`)}</dt>
            <dd className={cn("text-body font-semibold", scoreToneClass(clamp(value)))}><CountUp to={clamp(value)} /></dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <SaveSentenceChip save={save} />
      </div>
      {!attemptSaved && (
        <p data-testid="shadow-attempt-unsaved" className="mt-2 text-meta text-ink-2">{t("web.library.shadow.attemptNotSaved")}</p>
      )}
    </GlassSurface>
  );
}
