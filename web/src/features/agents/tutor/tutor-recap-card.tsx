import "./locales";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@renderer/lib/utils";
import { SurfaceCard } from "~/components/surface-card";
import { MAX_WORD_TARGET } from "~/lib/extension-points";
import { levelLabel } from "~/lib/levels";
import { WordActions } from "~/lib/extension-points-react";
import type { TutorPoint, TutorRecap, TutorVerdict } from "./tutor-api";
import { scoreBars } from "./tutor-model";

const BAR: Record<TutorVerdict, string> = { good: "bg-green", ok: "bg-blue", weak: "bg-amber", skip: "bg-ink-2 opacity-40" };
const KNOWN_FOCUS = new Set(["free", "today_words", "weak_words", "restaurant", "travel", "interview", "shopping", "small_talk"]);

function focusLabel(t: TFunction, focus: string): string {
  return KNOWN_FOCUS.has(focus) ? t(`web.agents.tutor.focus.${focus}`) : focus;
}

function Points({ title, points, tone, testId }: { title: string; points: TutorPoint[]; tone: "green" | "amber"; testId: string }) {
  const { t } = useTranslation();
  return (
    <div data-testid={testId} className="mt-3">
      <h4 className={cn("text-sub font-semibold", tone === "green" ? "text-green" : "text-amber")}>{title}</h4>
      {points.length ? (
        <ul className="mt-1 flex flex-col gap-0.5 text-body text-ink">
          {points.map((p) => <li key={`${p.kind}:${p.focus}`}>{t(`web.agents.tutor.kind.${p.kind}`)} · {focusLabel(t, p.focus)}</li>)}
        </ul>
      ) : <p className="mt-1 text-sub text-ink-2">{t("web.agents.tutor.recap.none")}</p>}
    </div>
  );
}

/** 带学总结卡(spec §7.4):得分分布、做得好、要加强、建议加入生词本的词(走 WordActions 插槽,不导入 vocabulary / wordbook)。 */
export function TutorRecapCard({ recap, showTitle = true }: { recap: TutorRecap; showTitle?: boolean }) {
  const { t } = useTranslation();
  const bars = scoreBars(recap);
  return (
    <SurfaceCard as="section" data-testid="tutor-recap" aria-label={t("web.agents.tutor.recap.title")} className="p-3.5">
      <header className="flex items-baseline justify-between gap-2">
        {showTitle ? <h3 className="text-title font-semibold text-ink">{t("web.agents.tutor.recap.title")}</h3> : <span />}
        <span data-testid="tutor-recap-count" className="text-meta text-ink-2">
          {t("web.agents.tutor.recap.count", { answered: recap.answered, total: recap.total })}
        </span>
      </header>
      <div aria-hidden className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-2">
        {bars.map((b) => (b.count ? <div key={b.verdict} className={BAR[b.verdict]} style={{ width: `${b.pct}%` }} /> : null))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-meta text-ink-2">
        {bars.map((b) => <li key={b.verdict} data-testid={`tutor-score-${b.verdict}`}>{t(`web.agents.tutor.verdict.${b.verdict}`)} {b.count}</li>)}
      </ul>
      {recap.levelStart !== recap.levelEnd ? (
        <p className="mt-2 text-sub text-ink">{t("web.agents.tutor.recap.level", { from: levelLabel(t, recap.levelStart), to: levelLabel(t, recap.levelEnd) })}</p>
      ) : null}
      <Points title={t("web.agents.tutor.recap.strengths")} points={recap.strengths} tone="green" testId="tutor-strengths" />
      <Points title={t("web.agents.tutor.recap.weaknesses")} points={recap.weaknesses} tone="amber" testId="tutor-weaknesses" />
      {recap.words.length ? (
        <section className="mt-3" aria-label={t("web.agents.tutor.recap.words")}>
          <h4 className="text-sub font-semibold text-ink">{t("web.agents.tutor.recap.words")}</h4>
          <ul className="mt-1 flex flex-col">
            {recap.words.map((w) => (
              <li key={w} className="flex min-h-tap items-center justify-between gap-2 border-b-[0.5px] border-hair last:border-0">
                <span className="min-w-0 truncate text-body text-teal">{w}</span>
                <WordActions target={{ word: w.slice(0, MAX_WORD_TARGET.word), source: "recap" }} testId={`tutor-word-${w}`} variant="icon" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </SurfaceCard>
  );
}
