import { CircleAlertIcon, GalleryVerticalEndIcon, KeyboardIcon, LibraryBigIcon, RefreshCwIcon, SlidersHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { IconChip } from "~/components/icon-chip";
import { ListRow, SectionGroup } from "~/components/section-group";
import { SurfaceCard } from "~/components/surface-card";
import { ToneBadge } from "~/components/tone-badge";
import { PageHeader } from "~/layout/page-header";
import { PageError, PageLoading, PageNote } from "./page-status";
import { PlanRing } from "./plan-ring";
import { ICON_LINK, PRIMARY, bookTitle, fmt } from "./ui";
import { useWordbookToday } from "./use-today";
import { useWordbookConfig } from "./use-wordbook-config";
import { WORDBOOK_SERVER_ERRORS, type DayPlan, type Enrollment, type Progress, type WordbookBook } from "./wordbook-api";

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

/** 今日计划:新词环、复习计数、明日预测(视觉稿 03「今天」)。 */
function PlanCard({ plan, tomorrowDue, enrollment }: { plan: DayPlan; tomorrowDue: number; enrollment: Enrollment | null }) {
  const { t } = useTranslation();
  const cell = (label: string, value: ReactNode, testId?: string) => (
    <div data-testid={testId} className="text-meta text-ink-2">
      {label}
      <b className="num block text-title font-semibold text-ink">{value}</b>
    </div>
  );
  return (
    <SurfaceCard className="flex items-center gap-3.5 p-3.5">
      <PlanRing done={plan.newDone} target={plan.newTarget} />
      <div className="grid flex-1 grid-cols-2 gap-2.5">
        {cell(t("web.wordbook.home.newWords"), `${plan.newDone} / ${plan.newTarget}`)}
        {cell(t("web.wordbook.home.reviews"), `${plan.reviewDone} / ${plan.reviewDone + plan.reviewLeft}`)}
        {cell(t("web.wordbook.home.tomorrow"), tomorrowDue, "wordbook-tomorrow")}
        {enrollment ? cell(t("web.wordbook.home.reviewCap"), enrollment.reviewCap) : null}
      </div>
    </SurfaceCard>
  );
}

/** 背单词首页(spec §11.2,视觉稿 03)。没选书 → 选书页;书被停用 → 提示换一本。 */
export function WordbookHomePage() {
  const { t } = useTranslation();
  const config = useWordbookConfig();
  const { today, error, reload } = useWordbookToday(config?.enabled !== false);
  const header = (
    <PageHeader title={t("web.wordbook.title")} back="/practice"
      actions={
        <Link to="/wordbook/books" aria-label={t("web.wordbook.home.settings")} className={ICON_LINK}>
          <SlidersHorizontalIcon aria-hidden />
        </Link>
      } />
  );
  let body: ReactNode;
  if (config?.enabled === false) body = <PageNote>{t("web.wordbook.errors.disabled")}</PageNote>;
  else if (error) body = <PageError message={translateServerError(t, error, WORDBOOK_SERVER_ERRORS)} onRetry={reload} />;
  else if (!today) body = <PageLoading />;
  else if (!today.enrollment) return <Navigate to="/wordbook/books" replace />;
  else if (!today.book || !today.plan || !today.progress) {
    body = (
      <SurfaceCard className="mt-2 p-3.5 text-center">
        <p className="text-body">{t("web.wordbook.card.bookDisabled")}</p>
        <Link to="/wordbook/books" className={cn(PRIMARY, "mt-3 h-11 w-full")}>{t("web.wordbook.home.switchBook")}</Link>
      </SurfaceCard>
    );
  } else {
    const { plan, progress, book, enrollment } = today;
    const done = <span className="text-meta text-ink-2">{t("web.wordbook.home.finished")}</span>;
    body = (
      <>
        <div className="mt-2"><BookCard book={book} progress={progress} enrollment={enrollment} /></div>
        <SectionGroup title={t("web.wordbook.home.today")} bare>
          <PlanCard plan={plan} tomorrowDue={today.tomorrowDue} enrollment={enrollment} />
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
    </div>
  );
}
