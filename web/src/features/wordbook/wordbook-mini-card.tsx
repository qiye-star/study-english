import { ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { SurfaceCard } from "~/components/surface-card";
import { cn } from "~/lib/cn";
import { fmt } from "./ui";
import { useWordbookToday } from "./use-today";
import { useWordbookConfig } from "./use-wordbook-config";

/**
 * 练习首页的生词本小卡:待复习数 + 一行掌握进度,点进 /wordbook。词书关闭或今日数据加载失败时不渲染;
 * 还没选词书时显示「—」与引导。
 */
export function WordbookMiniCard({ className }: { className?: string }) {
  const { t } = useTranslation();
  const config = useWordbookConfig();
  const { today } = useWordbookToday(config?.enabled === true);
  if (!config?.enabled || !today) return null;
  const ready = !!(today.plan && today.book && today.progress);
  return (
    <Link to="/wordbook" data-testid="wordbook-mini-card" aria-label={t("web.wordbook.card.title")} className="block min-w-0 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <SurfaceCard className={cn("flex min-h-[104px] flex-col justify-between p-3.5 transition-colors duration-fast active:bg-surface-2", className)}>
        <span className="flex items-center justify-between text-meta text-ink-2">
          {t("web.wordbook.card.title")}
          <ChevronRightIcon aria-hidden className="size-4 text-ink-3" />
        </span>
        <span className="mt-2 block min-w-0">
          <b className="num block truncate text-headline font-bold tracking-tightest text-ink">
            {ready ? today.plan!.reviewLeft : "—"}
            {ready && <small className="ml-1 text-meta font-medium text-ink-2">{t("web.wordbook.card.mini.due")}</small>}
          </b>
          <span className="mt-0.5 block truncate text-meta text-ink-2">
            {ready ? t("web.wordbook.card.mastered", { m: fmt(today.progress!.mastered), total: fmt(today.progress!.words) }) : t("web.wordbook.card.mini.empty")}
          </span>
        </span>
      </SurfaceCard>
    </Link>
  );
}
