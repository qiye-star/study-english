import { PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { Button } from "@renderer/components/ui/button";
import { formatDateTime } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { loadServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { CHAT_SERVER_ERRORS, createConversation, deleteConversation, listConversations, type Conversation } from "./chat-api";
import { defaultConversationConfig, displayName } from "./chat-request";

export function ConversationsPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<Conversation[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (page: number) => {
    try {
      const res = await listConversations(api, page);
      setItems((prev) => (page === 1 ? res.conversations : [...prev, ...res.conversations]));
      setNext(res.next);
    } catch (err) {
      setError(translateServerError(t, err, CHAT_SERVER_ERRORS));
    } finally {
      setLoaded(true);
    }
  }, [api, t]);

  useEffect(() => { void load(1); }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const ai = await loadServerAiConfig(api).catch((): null => null);
      const created = await createConversation(api, { config: defaultConversationConfig(ai) });
      navigate(`/chat/${created.id}`);
    } catch (err) {
      setError(translateServerError(t, err, CHAT_SERVER_ERRORS));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (conversation: Conversation) => {
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
        <Button data-testid="conversation-new" className="mr-1 h-11" disabled={creating} onClick={() => void create()}>
          <PlusIcon className="mr-1 h-4 w-4" />{t("web.chat.new")}
        </Button>
      } />
      {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
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
      {next && <Button variant="ghost" className="m-4 h-11" onClick={() => void load(next)}>{t("web.common.loadMore")}</Button>}
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
