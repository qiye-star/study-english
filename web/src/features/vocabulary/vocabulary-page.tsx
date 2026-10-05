import { Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { Button } from "@renderer/components/ui/button";
import { formatDateTime } from "@renderer/lib/utils";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { ttsErrorMessage, useTtsPlayer } from "~/features/chat/use-tts-player";
import { PageHeader } from "~/layout/page-header";
import { ReviewCard } from "./review-card";
import {
  REVIEW_BATCH, VOCABULARY_SERVER_ERRORS, deleteVocabularyItem, listVocabulary, reviewVocabularyItem,
  type VocabularyGrade, type VocabularyItem,
} from "./vocabulary-api";

interface ReviewState {
  queue: VocabularyItem[];
  index: number;
  flipped: boolean;
  done: boolean;
}

export function VocabularyPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VocabularyItem | null>(null);
  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);
  const busyRef = useRef(false); // 开始复习 / 评分共用的同步锁
  const deletingRef = useRef(new Set<string>());
  const tts = useTtsPlayer(api, { onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)) });
  const stopTts = tts.stop;

  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }).catch((): void => undefined);
    return () => { alive = false; };
  }, [api]);

  const fail = (err: unknown) => setError(translateServerError(tRef.current, err, VOCABULARY_SERVER_ERRORS));

  const load = useCallback(async (page: number, signal: AbortSignal) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError(null);
    try {
      const res = await listVocabulary(api, { page, perPage: 50 }, signal);
      if (signal.aborted) return;
      setItems((prev) => {
        const base = page === 1 ? [] : prev;
        const seen = new Set(base.map((i) => i.id));
        return [...base, ...res.vocabularyItems.filter((i) => !seen.has(i.id))];
      });
      setNext(res.next);
      setDueCount(res.dueCount);
    } catch (err) {
      if (!signal.aborted) setError(translateServerError(tRef.current, err, VOCABULARY_SERVER_ERRORS));
    } finally {
      if (!signal.aborted) {
        loadingRef.current = false;
        setLoaded(true);
      }
    }
  }, [api]);

  // 副作用自己持有 AbortController:卸载 / StrictMode 重跑时中止并释放锁
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    void load(1, controller.signal);
    return () => {
      controller.abort();
      loadingRef.current = false;
      busyRef.current = false;
    };
  }, [load]);

  const liveSignal = () => {
    const signal = abortRef.current?.signal;
    return signal && !signal.aborted ? signal : null;
  };

  const lock = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  };
  const unlock = (signal: AbortSignal) => {
    if (signal.aborted) return;
    busyRef.current = false;
    setBusy(false);
  };

  const startReview = async () => {
    const signal = liveSignal();
    if (!signal || !lock()) return;
    setError(null);
    try {
      const res = await listVocabulary(api, { perPage: REVIEW_BATCH, due: true }, signal);
      if (signal.aborted) return;
      setDueCount(res.dueCount);
      setReview(res.vocabularyItems.length ? { queue: res.vocabularyItems, index: 0, flipped: false, done: false } : null);
    } catch (err) {
      if (!signal.aborted) fail(err);
    } finally {
      unlock(signal);
    }
  };

  const grade = async (value: VocabularyGrade) => {
    const signal = liveSignal();
    const current = review;
    if (!signal || !current || current.done || !lock()) return; // 同步锁:连点只发一次评分
    const item = current.queue[current.index];
    setError(null);
    let refetch = false;
    try {
      await reviewVocabularyItem(api, item.id, value, signal);
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof ApiError && err.status === 409) {
        refetch = true; // 未到期 / 已在别处复习过:重新拉取待复习列表后继续
      } else if (!(err instanceof ApiError && err.status === 404)) { // 404:已在别处删除,跳过这张
        fail(err);
        unlock(signal);
        return;
      }
    }
    stopTts();
    const handled = current.queue.slice(0, current.index + 1);
    let queue = current.queue;
    if (refetch) {
      try {
        const res = await listVocabulary(api, { perPage: REVIEW_BATCH, due: true }, signal);
        if (signal.aborted) return;
        const seen = new Set(handled.map((i) => i.id));
        queue = [...handled, ...res.vocabularyItems.filter((i) => !seen.has(i.id))].slice(0, REVIEW_BATCH);
      } catch {
        if (signal.aborted) return; // 刷新失败就沿用原队列继续
      }
    }
    const index = current.index + 1;
    const done = index >= queue.length;
    setReview({ queue, index, flipped: false, done });
    unlock(signal);
    if (done) void load(1, signal); // 刷新待复习数与下次到期时间
  };

  const isDue = (item: VocabularyItem) => new Date(item.dueAt).getTime() <= Date.now();

  // 乐观删除:先从列表移除,失败(404 除外)再放回原位置
  const remove = async (item: VocabularyItem) => {
    const signal = liveSignal();
    setPendingDelete(null);
    if (!signal || deletingRef.current.has(item.id)) return;
    deletingRef.current.add(item.id);
    const position = items.findIndex((i) => i.id === item.id);
    const wasDue = isDue(item);
    setError(null);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    if (wasDue) setDueCount((n) => Math.max(0, n - 1));
    try {
      await deleteVocabularyItem(api, item.id, signal);
    } catch (err) {
      if (signal.aborted || (err instanceof ApiError && err.status === 404)) return;
      setItems((prev) => {
        if (prev.some((i) => i.id === item.id)) return prev;
        const at = position < 0 ? prev.length : Math.min(position, prev.length);
        return [...prev.slice(0, at), item, ...prev.slice(at)];
      });
      if (wasDue) setDueCount((n) => n + 1);
      fail(err);
    } finally {
      deletingRef.current.delete(item.id);
    }
  };

  const card = review && !review.done ? review.queue[review.index] : null;
  const speakKey = card ? `vocab-${card.id}` : "";

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.vocabulary.title")} back="/me" />
      <div className="space-y-4 p-4">
        {error && <p role="alert" data-testid="vocab-error" className="text-sm text-destructive">{error}</p>}
        {card && review && (
          <ReviewCard item={card} position={review.index + 1} total={review.queue.length} flipped={review.flipped} grading={busy}
            speakState={tts.states[speakKey] ?? "idle"} canSpeak={!!ai?.defaultTts.model}
            onFlip={() => setReview({ ...review, flipped: true })}
            onGrade={(g) => void grade(g)}
            onSpeak={() => ai && void tts.play(speakKey, card.word, ai.defaultTts.model, ai.defaultTts.voice)} />
        )}
        {review?.done && (
          <div data-testid="vocab-review-done" className="space-y-2 rounded-xl border p-4 text-center">
            <p>{t("web.vocabulary.done")}</p>
            <Button variant="outline" data-testid="vocab-review-close" className="h-11" onClick={() => setReview(null)}>{t("web.vocabulary.close")}</Button>
          </div>
        )}
        {!review && (
          <>
            <div className="flex items-center gap-2">
              <p data-testid="vocab-due-count" className="flex-1 text-sm">{t("web.vocabulary.due", { value: dueCount })}</p>
              <Button data-testid="vocab-start-review" className="h-11" disabled={busy || dueCount === 0} onClick={() => void startReview()}>
                {t("web.vocabulary.start")}
              </Button>
            </div>
            {loaded && items.length > 0 && dueCount === 0 && <p data-testid="vocab-none-due" className="text-sm text-muted-foreground">{t("web.vocabulary.noneDue")}</p>}
            {!loaded && <p className="text-center text-muted-foreground">{t("web.common.loading")}</p>}
            {loaded && !items.length && !error && <p data-testid="vocab-empty" className="p-6 text-center text-muted-foreground">{t("web.vocabulary.empty")}</p>}
            {items.length > 0 && (
              <section>
                <h2 className="mb-1 text-sm font-medium">{t("web.vocabulary.all")}</h2>
                <ul className="divide-y rounded-md border">
                  {items.map((i) => (
                    <li key={i.id} data-testid="vocab-item" className="flex items-center gap-2 pl-3">
                      <div className="min-w-0 flex-1 py-2">
                        <p className="truncate font-medium">{i.word}</p>
                        <p className="truncate text-xs text-muted-foreground">{i.meaning || t("web.vocabulary.noMeaning")}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("web.vocabulary.box", { value: i.box })} · {t("web.vocabulary.nextDue", { value: formatDateTime(i.dueAt) })}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" data-testid="vocab-item-delete" className="h-11 w-11 shrink-0"
                        aria-label={t("web.common.delete")} onClick={() => setPendingDelete(i)}>
                        <Trash2Icon className="h-5 w-5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {next && loaded && (
              <Button variant="ghost" data-testid="vocab-list-more" className="h-11 w-full"
                onClick={() => { const s = liveSignal(); if (s) void load(next, s); }}>{t("web.common.loadMore")}</Button>
            )}
          </>
        )}
      </div>
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("web.vocabulary.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription className="break-words">{pendingDelete?.word}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="vocab-item-delete-confirm" className="h-11"
              onClick={(e) => { e.preventDefault(); if (pendingDelete) void remove(pendingDelete); }}>{t("web.common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
