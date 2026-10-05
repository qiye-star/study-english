import { PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { Button } from "@renderer/components/ui/button";
import { formatDateTime } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
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
        <Button data-testid="conversation-new" className="mr-1 h-11" onClick={() => setPickerOpen(true)}>
          <PlusIcon className="mr-1 h-4 w-4" />{t("web.chat.new")}
        </Button>
      } />
      {!loaded && <p className="p-8 text-center text-muted-foreground">{t("web.common.loading")}</p>}
      {error && (
        <div role="alert" className="flex items-center gap-2 p-4 text-sm text-destructive">
          <span className="flex-1">{error}</span>
          {!items.length && (
            <Button variant="outline" className="h-11" onClick={() => void load(1)}>{t("web.common.retry")}</Button>
          )}
        </div>
      )}
      {loaded && !items.length && !error && (
        <p data-testid="conversations-empty" className="p-8 text-center text-muted-foreground">{t("web.chat.empty")}</p>
      )}
      <ul>
        {items.map((c) => (
          <li key={c.id} className="flex items-center border-b">
            <Link to={`/chat/${c.id}`} data-testid="conversation-item" className="flex min-h-14 min-w-0 flex-1 flex-col justify-center px-4 py-2">
              <span className="truncate">{displayName(c, t("web.chat.untitled"))}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(c.updatedAt)}</span>
            </Link>
            <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="conversation-delete"
              aria-label={t("web.common.delete")} onClick={() => setPendingDelete(c)}>
              <Trash2Icon className="h-5 w-5" />
            </Button>
          </li>
        ))}
      </ul>
      {next && <Button variant="ghost" className="m-4 h-11" disabled={loadingMore} onClick={() => void load(next)}>{t("web.common.loadMore")}</Button>}
      <ScenarioSheet open={pickerOpen} onOpenChange={setPickerOpen}
        onCreated={(id, openingId) => {
          setPickerOpen(false);
          navigate(`/chat/${id}`, openingId ? { state: { speakOpening: openingId } } : undefined);
        }}
        onDiscarded={() => void load(1)} />
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("web.chat.deleteConfirm")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="conversation-delete-confirm" className="h-11"
              onClick={() => pendingDelete && void remove(pendingDelete)}>{t("web.common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
