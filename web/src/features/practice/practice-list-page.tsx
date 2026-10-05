import { Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { Button } from "@renderer/components/ui/button";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { PRACTICE_ITEM_SERVER_ERRORS, deletePracticeItem, listPracticeItems, type PracticeItem } from "./practice-items-api";
import { goPractice } from "./save-practice-item";

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
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, []);

  const load = useCallback(async (page: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await listPracticeItems(api, page, 50, abortRef.current?.signal);
      if (!mounted.current) return;
      setItems((prev) => {
        const base = page === 1 ? [] : prev;
        const seen = new Set(base.map((i) => i.id));
        return [...base, ...res.practiceItems.filter((i) => !seen.has(i.id))];
      });
      setNext(res.next);
    } catch (err) {
      if (mounted.current) setError(translateServerError(tRef.current, err, PRACTICE_ITEM_SERVER_ERRORS));
    } finally {
      loadingRef.current = false;
      if (mounted.current) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, [api]);

  useEffect(() => { void load(1); }, [load]);

  const remove = async (item: PracticeItem) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError(null);
    try {
      await deletePracticeItem(api, item.id, abortRef.current?.signal);
      if (mounted.current) setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      if (mounted.current) setError(translateServerError(tRef.current, err, PRACTICE_ITEM_SERVER_ERRORS));
    } finally {
      deletingRef.current = false;
      if (mounted.current) {
        setDeleting(false);
        setPendingDelete(null);
      }
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.practice.list.title")} back="/practice" />
      {error && (
        <div role="alert" className="flex items-center gap-2 p-4 text-sm text-destructive">
          <span className="flex-1">{error}</span>
          {!items.length && (
            <Button variant="outline" data-testid="practice-list-retry" className="h-11" disabled={loading} onClick={() => void load(1)}>{t("web.common.retry")}</Button>
          )}
        </div>
      )}
      {!loaded && loading && <p className="p-8 text-center text-muted-foreground">{t("web.common.loading")}</p>}
      {loaded && !items.length && !error && (
        <p data-testid="practice-list-empty" className="p-8 text-center text-muted-foreground">{t("web.practice.list.empty")}</p>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.id} className="flex items-center border-b">
            <button type="button" data-testid="practice-item" className="min-h-14 min-w-0 flex-1 px-4 py-3 text-left"
              onClick={() => goPractice(navigate, item.text)}>
              <p className="line-clamp-2">{item.text}</p>
              <p className="text-xs text-muted-foreground">{t(`web.practice.list.sources.${item.source}`)}</p>
            </button>
            <Button variant="ghost" size="icon" data-testid="practice-item-delete" className="h-11 w-11 shrink-0"
              aria-label={t("web.common.delete")} onClick={() => setPendingDelete(item)}>
              <Trash2Icon className="h-5 w-5" />
            </Button>
          </li>
        ))}
      </ul>
      {next && loaded && (
        <Button variant="ghost" data-testid="practice-list-more" className="m-4 h-11" disabled={loading} onClick={() => void load(next)}>
          {t("web.common.loadMore")}
        </Button>
      )}
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
