import { CloudOffIcon, SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import "./changelog.css";
import { EntryCard } from "./entry-card";
import { filterByTag, formatMonth, groupByMonth, presentTags, type TagFilter } from "./entries";
import "./locales";
import { markSeen, seenDelayMs } from "./unread-store";
import { useChangelogList } from "./use-changelog-list";
import { useNearEnd } from "./use-near-end";

const CHIP_BASE = "h-8 flex-none rounded-full px-[13px] text-[13px] transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const RETRY = "min-h-tap rounded-button px-4 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Skeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t("web.common.loading")} data-testid="changelog-loading" className="mt-2 space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-card border-[0.5px] border-hair bg-surface p-3.5">
          <div className="h-3.5 w-[30%] rounded-[7px] bg-surface-2" />
          <div className="mt-2 h-[18px] w-[70%] rounded-[7px] bg-surface-2" />
          <div className="mt-2 h-3.5 rounded-[7px] bg-surface-2" />
          <div className="mt-2 h-3.5 w-[85%] rounded-[7px] bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

function StateNote({ testId, icon, message, action }: { testId: string; icon: ReactNode; message: string; action?: ReactNode }) {
  return (
    <div data-testid={testId} className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sub text-ink-2 [&_svg]:h-10 [&_svg]:w-10 [&_svg]:text-ink-3">
      {icon}
      <p>{message}</p>
      {action}
    </div>
  );
}

/**
 * 更新日志页 `/practice/changelog`(spec 2026-10-14-changelog §2.2、计划 R-17):按月份分组(最新在上)、类型筛选、首条展开、
 * 未读卡片带「新」角标、超过 2 条默认折叠、分页(滚动自动加载 + 「加载更多」按钮兜底)、骨架 / 空 / 失败重试 / 离线缓存。
 * 打开后 1 秒把已读位置报给服务端(提前离开就不报;离线缓存不报)。
 */
export function ChangelogPage() {
  const { t, i18n } = useTranslation();
  const { api, user } = useAuth();
  const userId = user?.id ?? null;
  const list = useChangelogList();
  const [tag, setTag] = useState<TagFilter>("all");

  useEffect(() => {
    if (list.status !== "ready" || list.offline || list.latestId === null) return;
    const latest = list.latestId;
    const timer = window.setTimeout((): void => { void markSeen(api, userId, latest); }, seenDelayMs());
    return () => window.clearTimeout(timer);
  }, [api, userId, list.status, list.offline, list.latestId]);

  const tags = useMemo(() => presentTags(list.entries), [list.entries]);
  const activeTag: TagFilter = tag !== "all" && tags.includes(tag) ? tag : "all";
  const shown = useMemo(() => filterByTag(list.entries, activeTag), [list.entries, activeTag]);
  const months = useMemo(() => groupByMonth(shown), [shown]);
  const sentinel = useNearEnd(list.loadMore, list.hasMore && !list.loadingMore && !list.moreFailed);
  const firstId = shown[0]?.id;

  let body: ReactNode;
  if (list.status === "loading") {
    body = <Skeleton />;
  } else if (list.status === "error") {
    body = (
      <StateNote testId="changelog-error" icon={<CloudOffIcon aria-hidden />} message={t("web.changelog.error")}
        action={<button type="button" data-testid="changelog-retry" onClick={list.reload} className={RETRY}>{t("web.common.retry")}</button>} />
    );
  } else if (list.entries.length === 0) {
    body = <StateNote testId="changelog-empty" icon={<SparklesIcon aria-hidden />} message={t("web.changelog.empty")} />;
  } else {
    body = (
      <>
        {list.offline ? (
          <p data-testid="changelog-offline" className="mt-2 flex items-center gap-2 rounded-button bg-surface-2 px-3 py-2 text-meta text-ink-2">
            <CloudOffIcon aria-hidden className="h-4 w-4 flex-none" />
            <span className="min-w-0 flex-1">{t("web.changelog.offline")}</span>
            <button type="button" onClick={list.reload} className="flex-none font-semibold text-blue">{t("web.common.retry")}</button>
          </p>
        ) : null}
        {tags.length >= 2 ? (
          <div role="group" aria-label={t("web.changelog.filters")} className="-mx-gutter flex gap-2 overflow-x-auto px-gutter pb-2 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(["all", ...tags] as TagFilter[]).map((value) => (
              <button key={value} type="button" aria-pressed={activeTag === value} onClick={() => setTag(value)}
                className={cn(CHIP_BASE, activeTag === value ? "bg-blue-tint font-semibold text-blue" : "bg-surface-2 text-ink-2")}>
                {value === "all" ? t("web.changelog.all") : t(`web.changelog.tag.${value}`)}
              </button>
            ))}
          </div>
        ) : null}
        {months.length === 0 ? (
          <p data-testid="changelog-no-match" className="px-6 py-10 text-center text-sub text-ink-2">{t("web.changelog.noMatch")}</p>
        ) : (
          months.map((group) => (
            <section key={group.key} aria-label={formatMonth(group.key, i18n.language)}>
              <h2 data-testid="changelog-month" className="mx-0.5 mb-0 mt-4 text-meta font-semibold tracking-[0.04em] text-ink-2">
                {formatMonth(group.key, i18n.language)}
              </h2>
              {group.entries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} language={i18n.language} defaultExpanded={entry.id === firstId} />
              ))}
            </section>
          ))
        )}
        {list.hasMore ? (
          <div ref={sentinel} className="mt-3 flex justify-center">
            <button type="button" data-testid="changelog-load-more" disabled={list.loadingMore} onClick={list.loadMore} className={RETRY}>
              {list.moreFailed ? t("web.changelog.loadMoreFailed") : t("web.changelog.loadMore")}
            </button>
          </div>
        ) : !list.offline ? (
          <p data-testid="changelog-end" className="my-4 text-center text-meta text-ink-3">{t("web.changelog.end")}</p>
        ) : null}
      </>
    );
  }

  return (
    <div data-testid="changelog-page" className="flex flex-1 flex-col">
      <PageHeader title={t("web.changelog.title")} back="/practice" />
      <div className="px-gutter pb-6">{body}</div>
    </div>
  );
}
