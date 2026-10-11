import { PinIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { IconButton } from "~/components/icon-button";
import { SurfaceCard } from "~/components/surface-card";
import { ToneBadge } from "~/components/tone-badge";
import { ConfirmSheet } from "./confirm-sheet";
import {
  MEMORY_KINDS, MEMORY_SERVER_ERRORS, deleteItem, fetchItems, pinItem, type MemoryItem, type MemoryKind,
} from "./memory-api";
import { Empty, ErrorNote, Loading } from "./status";
import { GHOST, KIND_TONE, NOTE, fmtDate, personaLabel } from "./ui";
import { useLoad } from "./use-load";

type Filter = MemoryKind | "all";
const FILTERS: Filter[] = ["all", ...MEMORY_KINDS];
const M = "web.agents.memory";
/** 置顶在前,其余保持服务端顺序(稳定排序)。 */
const pinnedFirst = (items: MemoryItem[]) => [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned));

export function ItemsTab() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const kind = filter === "all" ? undefined : filter;
  const { data, setData, error, retry } = useLoad((signal) => fetchItems(api, { kind }, signal), [api, filter]);
  const [status, setStatus] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // 等待第二步确认的记忆 id
  const [busy, setBusy] = useState(false);
  const fail = (err: unknown) => setStatus(translateServerError(t, err, MEMORY_SERVER_ERRORS));

  // 翻页请求属于发出时的筛选:换筛选就中止它,晚到的一页不得追加到新列表
  const moreCtl = useRef<AbortController | null>(null);
  useEffect(() => {
    setLoadingMore(false);
    return () => { moreCtl.current?.abort(); moreCtl.current = null; };
  }, [filter]);
  const loadMore = async () => {
    if (!data?.nextCursor || moreCtl.current) return;
    const controller = new AbortController();
    moreCtl.current = controller;
    setLoadingMore(true);
    try {
      const next = await fetchItems(api, { kind, cursor: data.nextCursor }, controller.signal);
      if (controller.signal.aborted) return;
      setData((d) => (d ? { ...next, items: [...d.items, ...next.items] } : next));
    } catch (err) {
      if (!controller.signal.aborted) fail(err);
    } finally {
      if (moreCtl.current === controller) {
        moreCtl.current = null;
        setLoadingMore(false);
      }
    }
  };
  const pin = async (item: MemoryItem) => {
    try {
      const next = await pinItem(api, item.id, !item.pinned);
      setData((d) => (d ? { ...d, items: pinnedFirst(d.items.map((i) => (i.id === next.id ? next : i))) } : d));
    } catch (err) {
      fail(err);
    }
  };
  const remove = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await deleteItem(api, pending);
      setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== pending) } : d));
      setStatus(t(`${M}.items.deleted`));
    } catch (err) {
      fail(err);
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t(`${M}.items.filterLabel`)} className="-mx-gutter flex gap-1.5 overflow-x-auto px-gutter pb-1">
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={cn("hit-expand h-8 flex-none whitespace-nowrap rounded-badge px-3 text-sub font-medium transition-colors duration-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === f ? "bg-blue-tint text-blue" : "bg-surface-2 text-ink-2")}>
            {t(`${M}.kinds.${f}`)}
          </button>
        ))}
      </div>
      {error ? (
        <ErrorNote message={translateServerError(t, error, MEMORY_SERVER_ERRORS)} onRetry={retry} />
      ) : !data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <Empty>{t(`${M}.items.empty`)}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((item) => (
            <li key={item.id} data-testid={`memory-item-${item.id}`}>
              <SurfaceCard className="flex items-start gap-1 py-3 pl-3.5 pr-1">
                <div className="min-w-0 flex-1">
                  <ToneBadge tone={KIND_TONE[item.kind]}>{t(`${M}.kinds.${item.kind}`)}</ToneBadge>
                  <p className="mt-1.5 break-words text-body text-ink">{item.text}</p>
                  <p className="mt-1 break-words text-sub text-ink-3">{personaLabel(t, item.persona)} · {fmtDate(item.updatedAt, i18n.language)}</p>
                </div>
                <IconButton label={t(item.pinned ? `${M}.items.unpin` : `${M}.items.pin`)} aria-pressed={item.pinned}
                  tone={item.pinned ? "blue" : "ink"} onClick={() => void pin(item)}>
                  <PinIcon />
                </IconButton>
                <IconButton label={t(`${M}.items.delete`)} onClick={() => setPending(item.id)}>
                  <Trash2Icon />
                </IconButton>
              </SurfaceCard>
            </li>
          ))}
        </ul>
      )}
      {data?.nextCursor ? (
        <button type="button" className={`${GHOST} h-11`} disabled={loadingMore} onClick={() => void loadMore()}>
          {t("web.common.loadMore")}
        </button>
      ) : null}
      <p role="status" aria-live="polite" className={NOTE}>{status ?? ""}</p>
      <ConfirmSheet open={pending !== null} busy={busy} title={t(`${M}.items.confirmTitle`)} description={t(`${M}.deleteBody`)}
        confirmLabel={t(`${M}.confirmDelete`)} onConfirm={() => void remove()} onCancel={() => setPending(null)} />
    </div>
  );
}
