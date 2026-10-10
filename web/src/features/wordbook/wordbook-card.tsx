import { CheckIcon, ChevronRightIcon, GalleryVerticalEndIcon, KeyboardIcon, LibraryBigIcon, RefreshCwIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { SurfaceCard } from "~/components/surface-card";
import { ToneBadge } from "~/components/tone-badge";
import { PlanRing } from "./plan-ring";
import { GHOST, PRIMARY, bookTitle, fmt } from "./ui";
import { useWordbookToday } from "./use-today";
import { useWordbookConfig } from "./use-wordbook-config";

/** 今日主按钮:先复习后新词,都完成为「今日完成」(spec §6.2 / §11.1)。 */
export function primaryAction(plan: { reviewLeft: number; newLeft: number }) {
  if (plan.reviewLeft > 0) return { to: "/wordbook/review", key: "web.wordbook.card.review", n: plan.reviewLeft } as const;
  if (plan.newLeft > 0) return { to: "/wordbook/learn", key: "web.wordbook.card.learn", n: plan.newLeft } as const;
  return { to: "/wordbook", key: "web.wordbook.card.done", n: 0 } as const;
}

/** 练习页「背单词」大卡(spec §11.1,视觉稿 01);开关关闭或今日数据未到时不渲染。 */
export function WordbookCard({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const config = useWordbookConfig();
  const enabled = config?.enabled === true;
  const { today, error, reload } = useWordbookToday(enabled);
  if (config?.enabled && !today && error) {
    // 今日数据拉取失败:保留卡片并给一个重试,不让入口整次访问都消失(review m13)
    return (
      <SurfaceCard data-testid="wordbook-card" className={cn("p-3.5", className)}>
        <div className="flex items-center gap-3.5">
          <span aria-hidden className="flex h-tap w-tap flex-none items-center justify-center rounded-button bg-teal-tint text-teal">
            <LibraryBigIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold tracking-[-0.01em]">{t("web.wordbook.card.title")}</p>
            <p role="alert" className="mt-[3px] text-meta text-ink-2">{t("web.wordbook.card.loadFailed")}</p>
          </div>
          <button type="button" onClick={reload} className={cn(GHOST, "h-11 flex-none px-4")}>{t("web.common.retry")}</button>
        </div>
      </SurfaceCard>
    );
  }
  if (!config?.enabled || !today) return null;
  if (!today.plan || !today.book || !today.progress) {
    return (
      <SurfaceCard data-testid="wordbook-card" className={cn("p-3.5", className)}>
        <div className="flex items-center gap-3.5">
          <span aria-hidden className="flex h-tap w-tap flex-none items-center justify-center rounded-button bg-teal-tint text-teal">
            <LibraryBigIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold tracking-[-0.01em]">{t("web.wordbook.card.title")}</p>
            <p className="mt-[3px] text-meta text-ink-2">{today.enrollment ? t("web.wordbook.card.bookDisabled") : t("web.wordbook.card.pitch", { n: config.defaults.dailyNew })}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Link to="/wordbook/books" className={cn(PRIMARY, "h-11 flex-1")}>{t("web.wordbook.card.pick")}</Link>
        </div>
      </SurfaceCard>
    );
  }
  const { plan, progress, book } = today;
  const primary = primaryAction(plan);
  return (
    <SurfaceCard data-testid="wordbook-card" className={cn("p-3.5", className)}>
      <Link to="/wordbook" data-testid="wordbook-card-open"
        className="-m-1 flex items-center gap-3.5 rounded-button p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <PlanRing done={plan.newDone} target={plan.newTarget} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-body font-semibold tracking-[-0.01em]">
            {t("web.wordbook.card.title")}
            <ToneBadge tone="teal">{bookTitle(book, i18n.language)}</ToneBadge>
          </span>
          <span className="mt-[3px] block text-meta text-ink-2">{t("web.wordbook.card.counts", { due: plan.reviewLeft, newLeft: plan.newLeft })}</span>
          <span className="mt-[3px] block text-meta text-ink-2">{t("web.wordbook.card.mastered", { m: fmt(progress.mastered), total: fmt(progress.words) })}</span>
        </span>
        <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3" />
      </Link>
      <div className="mt-3 flex gap-2">
        <Link to={primary.to} className={cn(PRIMARY, "h-11 flex-1")}>
          {primary.to === "/wordbook/review" ? <RefreshCwIcon aria-hidden /> : primary.to === "/wordbook/learn" ? <GalleryVerticalEndIcon aria-hidden /> : <CheckIcon aria-hidden />}
          {t(primary.key, { n: primary.n })}
        </Link>
        <Link to="/wordbook/spell" className={cn(GHOST, "h-11 flex-1")}>
          <KeyboardIcon aria-hidden />
          {t("web.wordbook.card.spell")}
        </Link>
      </div>
    </SurfaceCard>
  );
}
