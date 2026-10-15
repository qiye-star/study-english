import { ChevronRightIcon, FlameIcon, KeyboardIcon, LayersIcon, ListChecksIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { LQ_NOTE, LQ_PANEL, LQ_PANEL_STRONG, LQ_TILE, LQ_WELL } from "~/components/liquid";
import { PlanRing } from "./plan-ring";
import { GHOST, PRIMARY, fmt } from "./ui";
import type { DayPlan, Progress, Streak } from "./wordbook-api";

const pct = (n: number, total: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);

/**
 * 单词本首页的液态布局(设计稿 wordbook();计划 2026-10-15-liquid-glass L9-2):「今天」英雄面板就是全部决定 ——
 * 两个数字 + 墨色掌握带 + 唯一强调色按钮 + 次要胶囊;计划面板(井 + 墨色环);两个半宽面板。test id 与经典布局相同。
 */
export function WordbookTodayLiquid({ plan, progress, tomorrowDue, streak, learnedCount, extra }: {
  plan: DayPlan; progress: Progress; tomorrowDue: number; streak: Streak; learnedCount: ReactNode; extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const mastered = pct(progress.mastered, progress.words);
  const learning = pct(Math.max(0, progress.learned - progress.mastered), progress.words);
  const primary = plan.reviewLeft > 0 ? "review" : plan.newLeft > 0 ? "learn" : null;
  const pill = "h-[38px] flex-1 px-[15px] text-sub";
  const well = (label: string, value: ReactNode, testId?: string) => (
    <div data-testid={testId} className={cn("px-3 py-2.5", LQ_WELL)}>
      <b className="num block text-title font-bold text-ink">{value}</b>
      <span className="text-meta text-ink-2">{label}</span>
    </div>
  );
  return (
    <>
      <section aria-labelledby="wb-today" className={cn("mt-2 p-4", LQ_PANEL_STRONG)}>
        <h2 id="wb-today" className="mb-3 text-sub font-semibold text-ink-2">{t("web.wordbook.home.todayHero")}</h2>
        <div className="flex gap-7">
          <p><span className="num text-stat font-bold text-ink">{plan.reviewLeft}</span><span className="ml-1.5 text-sub text-ink-2">{t("web.wordbook.home.dueCount")}</span></p>
          <p><span className="num text-stat font-bold text-ink">{plan.newLeft}</span><span className="ml-1.5 text-sub text-ink-2">{t("web.wordbook.home.newCount")}</span></p>
        </div>
        <div role="progressbar" aria-label={t("web.wordbook.home.progressLabel")} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(mastered)} aria-valuetext={t("web.wordbook.card.mastered", { m: fmt(progress.mastered), total: fmt(progress.words) })}
          className="mt-3.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-wash">
          <i className="block h-full rounded-l-full bg-ink/85" style={{ width: `${mastered}%` }} />
          <i className="block h-full bg-wash-2 shadow-[inset_0_0_0_.5px_var(--hair)]" style={{ width: `${learning}%` }} />
        </div>
        <div data-testid="wordbook-legend" className="mt-2 flex justify-between text-meta text-ink-2">
          <span>{t("web.wordbook.home.bandLegend")}</span>
          <span className="num">{fmt(progress.mastered)} / {fmt(progress.words)}</span>
        </div>
        {primary === "review" ? (
          <Link to="/wordbook/review" data-testid="wordbook-action-review" className={cn(PRIMARY, "mt-4 h-[50px] w-full")}>
            {t("web.wordbook.home.startReview", { n: plan.reviewLeft })}
          </Link>
        ) : primary === "learn" ? (
          <Link to="/wordbook/learn" data-testid="wordbook-action-learn" className={cn(PRIMARY, "mt-4 h-[50px] w-full")}>
            {t("web.wordbook.home.learnNew", { n: plan.newLeft })}
          </Link>
        ) : (
          <p className="mt-4 text-center text-sub text-ink-2">{t("web.wordbook.home.finished")}</p>
        )}
        <div className="mt-2.5 flex gap-2.5">
          {primary !== "learn" ? (
            plan.newLeft > 0
              ? <Link to="/wordbook/learn" data-testid="wordbook-action-learn" className={cn(GHOST, pill)}>{t("web.wordbook.home.learnNew", { n: plan.newLeft })}</Link>
              : <span data-testid="wordbook-action-learn" aria-disabled className={cn(GHOST, pill, "opacity-40")}>{t("web.wordbook.home.learn")}</span>
          ) : null}
          {primary !== "review" ? (
            <span data-testid="wordbook-action-review" aria-disabled className={cn(GHOST, pill, "opacity-40")}>{t("web.wordbook.home.review")}</span>
          ) : null}
          <Link to="/wordbook/spell" data-testid="wordbook-action-spell" className={cn(GHOST, pill)}>
            <KeyboardIcon aria-hidden className="size-4" />{t("web.wordbook.home.spell")}
          </Link>
        </div>
      </section>

      <section aria-labelledby="wb-plan" className={cn("mt-4 p-4", LQ_PANEL)}>
        <h2 id="wb-plan" className="mb-3 text-sub font-semibold text-ink-2">{t("web.wordbook.home.plan")}</h2>
        <div className="flex items-center gap-2.5">
          <div className="grid flex-1 grid-cols-3 gap-2.5">
            {well(t("web.wordbook.home.reviews"), `${plan.reviewDone}/${plan.reviewDone + plan.reviewLeft}`)}
            {well(t("web.wordbook.home.tomorrow"), tomorrowDue, "wordbook-tomorrow")}
            {well(t("web.wordbook.goals.streak.cell"), streak.current > 0
              ? <span className="inline-flex items-center gap-1"><FlameIcon aria-hidden className="size-4 text-amber" />{t("web.wordbook.goals.streak.cellDays", { n: streak.current, count: streak.current })}</span>
              : t("web.wordbook.goals.streak.cellNone"), "wordbook-streak")}
          </div>
          <PlanRing done={plan.newDone} target={plan.newTarget} size={52} />
        </div>
        {plan.backlogGuard ? <p role="note" className={cn("mt-3 px-3 py-2.5 text-sub", LQ_NOTE)}>{t("web.wordbook.home.backlog")}</p> : null}
      </section>

      {extra}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link to="/wordbook/learned" data-testid="wordbook-action-learned" className={cn("flex min-h-16 items-center gap-2.5 px-4 py-3.5", LQ_TILE)}>
          <span aria-hidden className="well flex size-[34px] flex-none items-center justify-center rounded-full"><ListChecksIcon className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold text-ink">{t("web.wordbook.learned.title")}</span>
            {learnedCount}
          </span>
          <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
        </Link>
        <Link to="/wordbook/books" className={cn("flex min-h-16 items-center gap-2.5 px-4 py-3.5", LQ_TILE)}>
          <span aria-hidden className="well flex size-[34px] flex-none items-center justify-center rounded-full"><LayersIcon className="size-5" /></span>
          <span className="min-w-0 flex-1 text-body font-semibold text-ink">{t("web.wordbook.home.switchBook")}</span>
          <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
        </Link>
      </div>
    </>
  );
}
