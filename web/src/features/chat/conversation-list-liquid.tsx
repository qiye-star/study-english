import { ChevronRightIcon, MessagesSquareIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatDateTime } from "@renderer/lib/utils";
import { Avatar } from "~/components/avatar";
import { EmptyState } from "~/components/empty-state";
import { IconButton } from "~/components/icon-button";
import { LQ_PANEL, LQ_PANEL_STRONG, LQ_PRIMARY } from "~/components/liquid";
import { cn } from "~/lib/cn";
import type { Conversation } from "./chat-api";
import { displayName } from "./chat-request";

/**
 * 对话列表的液态布局(设计稿 chatlist();计划 2026-10-15-liquid-glass L5-1):「继续」英雄面板(唯一强调色按钮)、
 * 一个「全部对话」分组面板、不模糊的「新对话」悬浮胶囊(mat-float,底栏上方)。数据与动作全部来自 ConversationsPage。
 */
export function ConversationListLiquid({ items, loaded, error, next, loadingMore, onLoadMore, onDelete, onNew, errorBox }: {
  items: Conversation[];
  loaded: boolean;
  error: string | null;
  next: number | null;
  loadingMore: boolean;
  onLoadMore(): void;
  onDelete(c: Conversation): void;
  onNew(): void;
  errorBox: ReactNode;
}) {
  const { t } = useTranslation();
  const latest = items[0]; // 接口按 updated_at 倒序返回(server/app/routers/conversations.py)
  return (
    <div className="px-frame pb-20">
      {!loaded && <p className="py-10 text-center text-sub text-ink-2">{t("web.common.loading")}</p>}
      {errorBox}
      {loaded && !items.length && !error && (
        <EmptyState testId="conversations-empty" icon={MessagesSquareIcon} title={t("web.chat.empty")} className="mt-2" />
      )}
      {latest && (
        <section aria-labelledby="chat-continue" className={cn("mt-2 p-4", LQ_PANEL_STRONG)}>
          <h2 id="chat-continue" className="mb-3 flex items-center justify-between text-sub font-semibold text-ink-2">
            {t("web.chat.continue")}
            <span className="num font-normal">{formatDateTime(latest.updatedAt)}</span>
          </h2>
          <div className="flex items-center gap-3">
            <span aria-hidden><Avatar name={displayName(latest, t("web.chat.untitled"))} size="sm" className="size-11 text-body" /></span>
            <p className="min-w-0 flex-1 truncate text-body font-semibold text-ink">{displayName(latest, t("web.chat.untitled"))}</p>
          </div>
          <div className="mt-3 flex justify-end">
            <Link to={`/chat/${latest.id}`} data-testid="conversation-continue"
              className={cn("inline-flex h-[38px] items-center gap-1 rounded-button bg-blue px-[15px] text-sub font-semibold text-on-blue", LQ_PRIMARY)}>
              {t("web.chat.continueAction")}<ChevronRightIcon aria-hidden className="size-4" />
            </Link>
          </div>
        </section>
      )}
      {items.length > 0 && (
        <section aria-labelledby="chat-all" className={cn("mt-4 overflow-hidden py-1.5", LQ_PANEL)}>
          <h2 id="chat-all" className="px-4 pb-1 pt-2 text-sub font-semibold text-ink-2">{t("web.chat.all")}</h2>
          <ul className="divide-y-[0.5px] divide-hair-2">
            {items.map((c) => {
              const name = displayName(c, t("web.chat.untitled"));
              return (
                <li key={c.id} className="flex items-center pr-1">
                  <Link to={`/chat/${c.id}`} data-testid="conversation-item"
                    className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 transition-colors duration-fast active:bg-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span aria-hidden><Avatar name={name} size="sm" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-ink">{name}</span>
                      <span className="num mt-0.5 block text-meta text-ink-2">{formatDateTime(c.updatedAt)}</span>
                    </span>
                    <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
                  </Link>
                  <IconButton data-testid="conversation-delete" className="text-ink-2" label={t("web.common.delete")} onClick={() => onDelete(c)}>
                    <Trash2Icon />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {next && (
        <button type="button" disabled={loadingMore} onClick={onLoadMore}
          className="mx-auto mt-2 flex min-h-tap items-center rounded-full px-4 text-sub font-medium text-blue disabled:opacity-50">
          {t("web.common.loadMore")}
        </button>
      )}
      <button type="button" data-testid="conversation-new" onClick={onNew}
        className="mat-float fixed bottom-[var(--tab-bar-space)] right-3 z-30 inline-flex h-12 items-center gap-1.5 rounded-full px-[18px] text-body font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <PlusIcon aria-hidden className="size-5" />{t("web.chat.new")}
      </button>
    </div>
  );
}
