import {
  CircleAlertIcon, FlameIcon, GalleryVerticalEndIcon, KeyboardIcon, LibraryBigIcon, ListChecksIcon, PauseIcon, RefreshCwIcon, Settings2Icon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { IconChip } from "~/components/icon-chip";
import { ListRow, SectionGroup } from "~/components/section-group";
import { SurfaceCard } from "~/components/surface-card";
import { ToneBadge } from "~/components/tone-badge";
import { PageHeader } from "~/layout/page-header";
import { GoalsSheet } from "./goals-sheet";
import { PageError, PageLoading, PageNote } from "./page-status";
import { PlanRing } from "./plan-ring";
import { GHOST, ICON_LINK, PRIMARY, bookTitle, fmt } from "./ui";
import { useGoals } from "./use-goals";
import { useLearnedSummary } from "./use-learned";
import { useWordbookToday } from "./use-today";
import { useWordbookConfig } from "./use-wordbook-config";
import {
  WORDBOOK_SERVER_ERRORS, limitsOf, type DayPlan, type Enrollment, type Progress, type Streak, type WordbookBook,
} from "./wordbook-api";

const pct = (n: number, total: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);

/** 书卡:书名徽标、三段进度条(已掌握 / 已学 / 剩余)与图例(视觉稿 03)。 */
function BookCard({ book, progress, enrollment }: { book: WordbookBook; progress: Progress; enrollment: Enrollment | null }) {
  const { t, i18n } = useTranslation();
  const mastered = pct(progress.mastered, progress.words);
  const learning = pct(Math.max(0, progress.learned - progress.mastered), progress.words);
  const order = enrollment ? t(`web.wordbook.books.order.${enrollment.orderMode}`) : null;
  return (
    <SurfaceCard className="p-3.5">
      <div className="flex items-center gap-2">
        <ToneBadge tone="teal"><LibraryBigIcon aria-hidden />{bookTitle(book, i18n.language)}</ToneBadge>
        <span className="num text-meta text-ink-2">
          {t("web.wordbook.home.total", { n: fmt(progress.words) })}{order ? ` · ${order}` : ""}
        </span>
      </div>
      <div role="progressbar" aria-label={t("web.wordbook.home.progressLabel")} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(mastered)} aria-valuetext={t("web.wordbook.card.mastered", { m: fmt(progress.mastered), total: fmt(progress.words) })}
        className="mt-3 flex h-2.5 overflow-hidden rounded-[5px] bg-surface-2">
        <i className="block h-full bg-teal" style={{ width: `${mastered}%` }} />
        <i className="block h-full bg-teal-tint shadow-[inset_0_0_0_0.5px_rgb(var(--teal)/0.25)]" style={{ width: `${learning}%` }} />
      </div>
      <dl data-testid="wordbook-legend" className="mt-2.5 grid grid-cols-3">
        {([
          ["mastered", progress.mastered, "bg-teal"],
          ["learned", progress.learned, "bg-teal-tint shadow-[inset_0_0_0_0.5px_rgb(var(--teal)/0.35)]"],
          ["remaining", progress.remaining, "bg-surface-2"],
        ] as const).map(([key, value, swatch]) => (
          <div key={key} className="text-meta text-ink-2">
            <dt className="flex items-center"><span aria-hidden className={cn("mr-1 inline-block h-2 w-2 rounded-[2px]", swatch)} />{t(`web.wordbook.home.${key}`)}</dt>
            <dd className="num text-headline font-semibold text-ink">{fmt(value)}</dd>
          </div>
        ))}
      </dl>
    </SurfaceCard>
  );
}

/** 今日计划:新词环、复习、明日预测、连续达标;右上角齿轮打开目标面板(spec 2026-10-11 §2.1,视觉稿 01)。 */
function PlanCard({ plan, tomorrowDue, streak, onSettings }: { plan: DayPlan; tomorrowDue: number; streak: Streak; onSettings: () => void }) {
  const { t } = useTranslation();
  const cell = (label: string, value: ReactNode, testId?: string) => (
    <div data-testid={testId} className="text-meta text-ink-2">
      {label}
      <b className="num block text-title font-semibold text-ink">{value}</b>
    </div>
  );
  const streakValue = streak.current > 0 ? (
    <span className="inline-flex items-center gap-1">
      <FlameIcon aria-hidden className="h-4 w-4 text-amber" />
      {t("web.wordbook.goals.streak.cellDays", { n: streak.current, count: streak.current })}
    </span>
  ) : t("web.wordbook.goals.streak.cellNone");
  return (
    <SurfaceCard className="relative flex items-center gap-3.5 p-3.5 pr-[52px]">
      <PlanRing done={plan.newDone} target={plan.newTarget} />
      <div className="grid flex-1 grid-cols-2 gap-2.5">
        {cell(t("web.wordbook.home.newWords"), `${plan.newDone} / ${plan.newTarget}`)}
        {cell(t("web.wordbook.home.reviews"), `${plan.reviewDone} / ${plan.reviewDone + plan.reviewLeft}`)}
        {cell(t("web.wordbook.home.tomorrow"), tomorrowDue, "wordbook-tomorrow")}
        {cell(t("web.wordbook.goals.streak.cell"), streakValue, "wordbook-streak")}
      </div>
      <button type="button" onClick={onSettings} aria-label={t("web.wordbook.goals.openFromRing")}
        className={cn(ICON_LINK, "absolute right-1 top-1 text-ink-2")}>
        <Settings2Icon aria-hidden />
      </button>
    </SurfaceCard>
  );
}

/** 背单词首页(spec §11.2 + goals §2、§7)。没选书 → 选书页;暂停 → 暂停卡;书被停用 → 提示换一本。 */
export function WordbookHomePage() {
  const { t, i18n } = useTranslation();
  const config = useWordbookConfig();
  const { today, error, reload, setToday } = useWordbookToday(config?.enabled !== false);
  const limits = limitsOf(config);
  const goals = useGoals({ today, setToday, reload, limits });
  // 「已学 N 词」只在有选中的书时才问;失败时不显示数字,入口仍在
  const learnedSummary = useLearnedSummary(Boolean(today?.enrollment)).summary;
  const [sheet, setSheet] = useState<null | "all" | "bonus">(null);
  const editable = Boolean(config?.enabled !== false && !error && today?.enrollment && today.plan && today.book && today.progress);
  const header = (
    <PageHeader title={t("web.wordbook.title")} back="/practice"
      actions={editable ? (
        <button type="button" aria-label={t("web.wordbook.goals.open")} className={ICON_LINK} onClick={() => setSheet("all")}>
          <Settings2Icon aria-hidden />
        </button>
      ) : undefined} />
  );
  let body: ReactNode;
  if (config?.enabled === false) body = <PageNote>{t("web.wordbook.errors.disabled")}</PageNote>;
  else if (error) body = <PageError message={translateServerError(t, error, WORDBOOK_SERVER_ERRORS)} onRetry={reload} />;
  else if (!today) body = <PageLoading />;
  else if (!today.enrollment) {
    // 老版本服务端没有 paused 键:undefined 视同没有暂停的书
    const paused = today.paused;
    if (!paused) return <Navigate to="/wordbook/books" replace />;
    const pausedBook = config?.enabled ? config.books.find((b) => b.id === paused.bookId) : undefined;
    body = (
      <div data-testid="wordbook-paused" className="mt-2">
        <SurfaceCard className="p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <ToneBadge tone="teal"><LibraryBigIcon aria-hidden />{pausedBook ? bookTitle(pausedBook, i18n.language) : paused.bookId}</ToneBadge>
            <ToneBadge tone="gray"><PauseIcon aria-hidden />{t("web.wordbook.goals.paused.badge")}</ToneBadge>
          </div>
          <p className="mt-2.5 text-sub leading-dialogue text-ink-2">{t("web.wordbook.goals.paused.note")}</p>
          {goals.error ? <p role="alert" className="mt-2 text-sub text-ink">{goals.error}</p> : null}
          <div className="mt-3 flex gap-2">
            <Link to="/wordbook/books" className={cn(GHOST, "h-11 flex-1")}>{t("web.wordbook.goals.paused.switch")}</Link>
            <button type="button" className={cn(PRIMARY, "h-11 flex-1")} disabled={goals.busy === "resume"}
              onClick={() => void goals.resume(paused.bookId)}>
              {t("web.wordbook.goals.paused.resume")}
            </button>
          </div>
        </SurfaceCard>
      </div>
    );
  } else if (!today.book || !today.plan || !today.progress) {
    body = (
      <SurfaceCard className="mt-2 p-3.5 text-center">
        <p className="text-body">{t("web.wordbook.card.bookDisabled")}</p>
        <Link to="/wordbook/books" className={cn(PRIMARY, "mt-3 h-11 w-full")}>{t("web.wordbook.home.switchBook")}</Link>
      </SurfaceCard>
    );
  } else {
    const { plan, progress, book, enrollment } = today;
    // 老版本服务端没有 streak:按 0 天显示
    const streak = today.streak ?? { current: 0, todayMet: false };
    const done = <span className="text-meta text-ink-2">{t("web.wordbook.home.finished")}</span>;
    body = (
      <>
        <div className="mt-2"><BookCard book={book} progress={progress} enrollment={enrollment} /></div>
        <SectionGroup title={t("web.wordbook.home.today")} bare>
          <PlanCard plan={plan} tomorrowDue={today.tomorrowDue} streak={streak} onSettings={() => setSheet("all")} />
          {plan.goalMet && plan.newLeft === 0 && limits.bonusMax > 0 ? (
            <SurfaceCard className="mt-2 flex items-center gap-3 p-3.5">
              <FlameIcon aria-hidden className="h-6 w-6 flex-none text-amber" />
              <div className="min-w-0 flex-1">
                <b className="block text-body font-semibold">{t("web.wordbook.goals.goalMet.title")}</b>
                <span className="text-meta text-ink-2">{t("web.wordbook.goals.goalMet.body")}</span>
              </div>
              <button type="button" className={cn(GHOST, "h-11")} onClick={() => setSheet("bonus")}>{t("web.wordbook.goals.goalMet.action")}</button>
            </SurfaceCard>
          ) : null}
          <div className="mt-2 divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface">
            <ListRow icon={<IconChip tone="blue" icon={RefreshCwIcon} />} title={t("web.wordbook.home.review")} testId="wordbook-action-review"
              subtitle={t("web.wordbook.home.reviewHint", { n: plan.reviewDue })}
              value={plan.reviewLeft > 0 ? <ToneBadge tone="blue" className="num">{plan.reviewLeft}</ToneBadge> : done}
              to={plan.reviewLeft > 0 ? "/wordbook/review" : undefined} />
            <ListRow icon={<IconChip tone="teal" icon={GalleryVerticalEndIcon} />} title={t("web.wordbook.home.learn")} testId="wordbook-action-learn"
              subtitle={t("web.wordbook.home.learnHint")}
              value={plan.newLeft > 0 ? <ToneBadge tone="teal" className="num">{plan.newLeft}</ToneBadge> : done}
              to={plan.newLeft > 0 ? "/wordbook/learn" : undefined} />
            <ListRow icon={<IconChip tone="amber" icon={KeyboardIcon} />} title={t("web.wordbook.home.spell")} testId="wordbook-action-spell"
              subtitle={t("web.wordbook.home.spellHint")} to="/wordbook/spell" />
            <ListRow icon={<IconChip tone="gray" icon={ListChecksIcon} />} title={t("web.wordbook.learned.title")} testId="wordbook-action-learned"
              subtitle={t("web.wordbook.learned.row.hint")}
              value={learnedSummary ? <span className="num text-meta text-ink-2">{t("web.wordbook.learned.row.count", { n: learnedSummary.total, count: learnedSummary.total })}</span> : undefined}
              to="/wordbook/learned" />
          </div>
          {plan.backlogGuard ? (
            <p role="note" className="mt-2 flex items-start gap-2 rounded-badge bg-amber-tint px-3 py-2.5 text-sub font-medium text-amber">
              <CircleAlertIcon aria-hidden className="mt-px h-[17px] w-[17px] flex-none" />
              <span>{t("web.wordbook.home.backlog")}</span>
            </p>
          ) : null}
        </SectionGroup>
      </>
    );
  }
  return (
    <div>
      {header}
      <div className="px-gutter pb-6">{body}</div>
      {editable && today ? (
        <GoalsSheet open={sheet !== null} onOpenChange={(o) => { if (!o) setSheet(null); }} today={today} limits={limits} goals={goals}
          focus={sheet === "bonus" ? "bonus" : undefined} />
      ) : null}
    </div>
  );
}
