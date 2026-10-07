import { MessagesSquareIcon, PencilIcon, SearchIcon, SpellCheckIcon, Trash2Icon, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { Button } from "@renderer/components/ui/button";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { IconButton } from "~/components/icon-button";
import { IconChip } from "~/components/icon-chip";
import { LIST_CARD, PAGE_NOTE } from "~/components/list-card";
import type { Tone } from "~/components/tone";
import { PageHeader } from "~/layout/page-header";
import {
  PRACTICE_ITEM_SERVER_ERRORS, deletePracticeItem, listPracticeItems, type PracticeItem, type PracticeItemSource,
} from "./practice-items-api";
import { goPractice } from "./save-practice-item";

/** 列表片按来源着色:对话 = 蓝,其它来源中性 */
const SOURCE: Record<PracticeItemSource, { tone: Tone; icon: LucideIcon }> = {
  chat: { tone: "blue", icon: MessagesSquareIcon },
  lookup: { tone: "gray", icon: SearchIcon },
  grammar: { tone: "gray", icon: SpellCheckIcon },
  manual: { tone: "gray", icon: PencilIcon },
};

export function PracticeListPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<PracticeItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PracticeItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;
  const loadingRef = useRef(false);
  const deletingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (page: number, signal: AbortSignal) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await listPracticeItems(api, page, 50, signal);
      if (signal.aborted) return;
      setItems((prev) => {
        const base = page === 1 ? [] : prev;
        const seen = new Set(base.map((i) => i.id));
        return [...base, ...res.practiceItems.filter((i) => !seen.has(i.id))];
      });
      setNext(res.next);
    } catch (err) {
      // 被中止(卸载 / StrictMode 重跑副作用)不是错误
      if (!signal.aborted) setError(translateServerError(tRef.current, err, PRACTICE_ITEM_SERVER_ERRORS));
    } finally {
      if (!signal.aborted) {
        loadingRef.current = false;
        setLoading(false);
        setLoaded(true);
      }
    }
  }, [api]);

  // 触发首次加载的副作用自己持有 AbortController:清理时中止并释放加载锁,StrictMode 重跑才能重新发起
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    void load(1, controller.signal);
    return () => {
      controller.abort();
      loadingRef.current = false;
      deletingRef.current = false;
    };
  }, [load]);

  const loadPage = (page: number) => {
    const signal = abortRef.current?.signal;
    if (signal && !signal.aborted) void load(page, signal);
  };

  const remove = async (item: PracticeItem) => {
    const signal = abortRef.current?.signal;
    if (!signal || signal.aborted || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError(null);
    try {
      await deletePracticeItem(api, item.id, signal);
      if (!signal.aborted) setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      if (signal.aborted) return;
      setError(translateServerError(tRef.current, err, PRACTICE_ITEM_SERVER_ERRORS));
      // 服务端说它已不存在:列表里也移除
      if (err instanceof ApiError && err.status === 404) setItems((prev) => prev.filter((i) => i.id !== item.id));
    } finally {
      if (!signal.aborted) {
        deletingRef.current = false;
        setDeleting(false);
        setPendingDelete(null);
      }
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.practice.list.title")} back="/practice" />
      <div className="px-gutter pb-6 pt-2">
        {error && (
          <div role="alert" className="mb-3 flex items-center gap-2 text-sub text-destructive">
            <span className="flex-1">{error}</span>
            {!items.length && (
              <Button variant="outline" data-testid="practice-list-retry" className="h-tap" disabled={loading} onClick={() => loadPage(1)}>{t("web.common.retry")}</Button>
            )}
          </div>
        )}
        {!loaded && loading && <p className={PAGE_NOTE}>{t("web.common.loading")}</p>}
        {loaded && !items.length && !error && (
          <p data-testid="practice-list-empty" className={PAGE_NOTE}>{t("web.practice.list.empty")}</p>
        )}
        {items.length > 0 && (
          <ul className={LIST_CARD}>
            {items.map((item) => {
              const source = SOURCE[item.source] ?? SOURCE.manual;
              return (
                <li key={item.id} className="flex items-center">
                  <button type="button" data-testid="practice-item"
                    className="flex min-h-row min-w-0 flex-1 items-center gap-3 py-2.5 pl-3.5 pr-1 text-left transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => goPractice(navigate, item.text)}>
                    <IconChip tone={source.tone} icon={source.icon} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-body font-medium tracking-[-0.005em] text-ink">{item.text}</span>
                      <span className="mt-0.5 block text-meta text-ink-2">{t(`web.practice.list.sources.${item.source}`)}</span>
                    </span>
                  </button>
                  <IconButton label={t("web.common.delete")} data-testid="practice-item-delete" className="mr-1 text-ink-2"
                    onClick={() => setPendingDelete(item)}>
                    <Trash2Icon />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
        {next && loaded && (
          <Button variant="ghost" data-testid="practice-list-more" className="mt-3 h-tap w-full text-blue" disabled={loading} onClick={() => loadPage(next)}>
            {t("web.common.loadMore")}
          </Button>
        )}
      </div>
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("web.practice.list.deleteConfirm")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={deleting}>{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="practice-item-delete-confirm" className="h-11" disabled={deleting}
              onClick={(e) => { e.preventDefault(); if (pendingDelete) void remove(pendingDelete); }}>{t("web.common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
