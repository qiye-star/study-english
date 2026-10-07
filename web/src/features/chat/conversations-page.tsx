import { MessagesSquareIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { formatDateTime } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { Avatar } from "~/components/avatar";
import { IconButton } from "~/components/icon-button";
import { IconChip } from "~/components/icon-chip";
import { PageHeader } from "~/layout/page-header";
import { CHAT_SERVER_ERRORS, deleteConversation, listConversations, type Conversation } from "./chat-api";
import { displayName } from "./chat-request";
import { ScenarioSheet } from "./scenario-sheet";

export function ConversationsPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<Conversation[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // 用 ref 读取最新的 t:切换语言不应让 load 变化,否则会重置已加载的分页。
  const tRef = useRef(t);
  tRef.current = t;
  const loadingRef = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (page: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(page > 1);
    setError(null);
    try {
      const res = await listConversations(api, page);
      setItems((prev) => {
        const base = page === 1 ? [] : prev;
        const seen = new Set(base.map((c) => c.id));
        return [...base, ...res.conversations.filter((c) => !seen.has(c.id))];
      });
      setNext(res.next);
    } catch (err) {
      setError(translateServerError(tRef.current, err, CHAT_SERVER_ERRORS));
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => { void load(1); }, [load]);

  const remove = async (conversation: Conversation) => {
    setError(null);
    try {
      await deleteConversation(api, conversation.id);
      setItems((prev) => prev.filter((c) => c.id !== conversation.id));
    } catch (err) {
      setError(translateServerError(t, err, CHAT_SERVER_ERRORS));
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.chat.title")} actions={
        <button type="button" data-testid="conversation-new" onClick={() => setPickerOpen(true)}
          className="hit-expand mr-1 inline-flex h-8 items-center gap-1 rounded-full bg-blue pl-2.5 pr-3 text-sub font-semibold text-on-blue transition-opacity duration-fast hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <PlusIcon aria-hidden className="h-4 w-4" />{t("web.chat.new")}
        </button>
      } />
      <div className="px-gutter pb-6 pt-1">
        {!loaded && <p className="py-10 text-center text-sub text-ink-2">{t("web.common.loading")}</p>}
        {error && (
          <div role="alert" className="mb-2 flex items-center gap-2 rounded-card bg-surface-2 py-1 pl-3.5 pr-1 text-sub text-red">
            <span className="flex-1">{error}</span>
            {!items.length && (
              <button type="button" onClick={() => void load(1)}
                className="inline-flex min-h-tap items-center rounded-button px-3 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("web.common.retry")}
              </button>
            )}
          </div>
        )}
        {loaded && !items.length && !error && (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <IconChip tone="blue" icon={MessagesSquareIcon} />
            <p data-testid="conversations-empty" className="max-w-[24ch] text-sub text-ink-2">{t("web.chat.empty")}</p>
          </div>
        )}
        {items.length > 0 && (
          <ul className="divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface">
            {items.map((c) => {
              const name = displayName(c, t("web.chat.untitled"));
              return (
                <li key={c.id} className="flex items-center pr-1">
                  <Link to={`/chat/${c.id}`} data-testid="conversation-item"
                    className="flex min-h-row min-w-0 flex-1 items-center gap-3 py-2.5 pl-3.5 transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span aria-hidden><Avatar name={name} size="sm" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium tracking-[-0.005em] text-ink">{name}</span>
                      <span className="num mt-0.5 block text-meta text-ink-2">{formatDateTime(c.updatedAt)}</span>
                    </span>
                  </Link>
                  <IconButton data-testid="conversation-delete" className="text-ink-2" label={t("web.common.delete")} onClick={() => setPendingDelete(c)}>
                    <Trash2Icon />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
        {next && (
          <button type="button" disabled={loadingMore} onClick={() => void load(next)}
            className="mx-auto mt-2 flex min-h-tap items-center rounded-button px-4 text-sub font-medium text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            {t("web.common.loadMore")}
          </button>
        )}
      </div>
      <ScenarioSheet open={pickerOpen} onOpenChange={setPickerOpen}
        onCreated={(id, openingId) => {
          setPickerOpen(false);
          navigate(`/chat/${id}`, openingId ? { state: { speakOpening: openingId } } : undefined);
        }}
        onDiscarded={() => void load(1)} />
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
          <AlertDialogHeader><AlertDialogTitle className="text-title font-semibold text-ink">{t("web.chat.deleteConfirm")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="conversation-delete-confirm" className="h-11 rounded-button bg-red-solid text-white hover:bg-red-solid/90"
              onClick={() => pendingDelete && void remove(pendingDelete)}>{t("web.common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
