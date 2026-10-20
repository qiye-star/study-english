import { BookOpenIcon, CheckIcon, Trash2Icon } from "lucide-react";
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
import { IconButton } from "~/components/icon-button";
import { IconChip } from "~/components/icon-chip";
import { LIST_CARD, PAGE_NOTE } from "~/components/list-card";
import { LQ_DANGER_TEXT, LQ_DIALOG, LQ_ICON_WELL, LQ_PAGE, LQ_SECONDARY } from "~/components/liquid";
import { SectionGroup } from "~/components/section-group";
import { SurfaceCard } from "~/components/surface-card";
import { ToneBadge } from "~/components/tone-badge";
import { ttsErrorMessage, useTtsPlayer } from "~/features/chat";
import { resolveTtsVoice } from "~/settings/tts-voice-pref";
import { PageHeader } from "~/layout/page-header";
import { Slot } from "~/lib/extension-points-react";
import { lookupContext } from "~/lib/lookup-context";
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
  const [noneDue, setNoneDue] = useState(false);
  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);
  const refreshQueuedRef = useRef(false); // 加载更多进行中时请求的第 1 页刷新,结束后补发
  const dueGenRef = useRef(0); // 每次用服务端的 due_count 覆盖时 +1;回滚只在没有更新的服务端值时修正
  const focusDueRef = useRef(false);
  const dueCountRef = useRef<HTMLParagraphElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
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
    if (loadingRef.current) {
      if (page === 1) refreshQueuedRef.current = true;
      return;
    }
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
      dueGenRef.current += 1;
      setDueCount(res.dueCount);
    } catch (err) {
      if (!signal.aborted) setError(translateServerError(tRef.current, err, VOCABULARY_SERVER_ERRORS));
    } finally {
      if (!signal.aborted) {
        loadingRef.current = false;
        setLoaded(true);
        if (refreshQueuedRef.current) {
          refreshQueuedRef.current = false;
          void load(1, signal);
        }
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
      refreshQueuedRef.current = false;
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
    setNoneDue(false);
    try {
      const res = await listVocabulary(api, { perPage: REVIEW_BATCH, due: true }, signal);
      if (signal.aborted) return;
      dueGenRef.current += 1;
      if (res.vocabularyItems.length) {
        setDueCount(res.dueCount);
        setReview({ queue: res.vocabularyItems, index: 0, flipped: false, done: false });
      } else {
        // 别的设备已复习完:显示"没有要复习的"并把焦点留在待复习数上(按钮随之禁用)
        setDueCount(0);
        setNoneDue(true);
        focusDueRef.current = true;
      }
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
    if (signal.aborted) return; // 卸载后不再更新状态或刷新
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
    const gen = dueGenRef.current;
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
      if (wasDue && gen === dueGenRef.current) setDueCount((n) => n + 1); // 期间刷新过就以服务端值为准
      fail(err);
    } finally {
      deletingRef.current.delete(item.id);
    }
  };

  // 完成面板出现时聚焦"返回列表";返回列表 / 没有要复习的时聚焦待复习数
  const reviewDone = !!review?.done;
  useEffect(() => {
    if (reviewDone) closeRef.current?.focus();
  }, [reviewDone]);
  useEffect(() => {
    if (!review && focusDueRef.current) {
      focusDueRef.current = false;
      dueCountRef.current?.focus();
    }
  });

  const card = review && !review.done ? review.queue[review.index] : null;
  const speakKey = card ? `vocab-${card.id}` : "";

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.vocabulary.title")} back="/me" />
      <div className={`space-y-3 px-gutter pb-6 pt-1 ${LQ_PAGE}`}>
        {error && <p role="alert" data-testid="vocab-error" className="text-sub text-destructive">{error}</p>}
        {card && review && (
          <ReviewCard item={card} position={review.index + 1} total={review.queue.length} flipped={review.flipped} grading={busy}
            speakState={tts.states[speakKey] ?? "idle"} canSpeak={!!ai?.defaultTts.model}
            onFlip={() => setReview({ ...review, flipped: true })}
            onGrade={(g) => void grade(g)}
            onSpeak={() => { if (ai) { const voice = resolveTtsVoice("word", ai); void tts.play(speakKey, card.word, voice.model, voice.voice); } }} />
        )}
        {review?.done && (
          <SurfaceCard data-testid="vocab-review-done" className="space-y-3 p-5 text-center">
            <span className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-teal-tint text-teal ${LQ_ICON_WELL}`} aria-hidden>
              <CheckIcon className="h-6 w-6" />
            </span>
            <p className="text-body font-medium text-ink">{t("web.vocabulary.done")}</p>
            <Button ref={closeRef} variant="outline" data-testid="vocab-review-close" className="h-tap"
              onClick={() => { focusDueRef.current = true; setReview(null); }}>{t("web.vocabulary.close")}</Button>
          </SurfaceCard>
        )}
        {!review && (
          <>
            <SurfaceCard className="flex items-center gap-3 p-3.5">
              <IconChip tone="teal" icon={BookOpenIcon} />
              <p ref={dueCountRef} tabIndex={-1} data-testid="vocab-due-count"
                className="min-w-0 flex-1 text-body font-medium text-ink outline-none focus-visible:underline">{t("web.vocabulary.due", { value: dueCount })}</p>
              <Button data-testid="vocab-start-review" className="h-tap rounded-button px-4 font-semibold" disabled={busy || dueCount === 0} onClick={() => void startReview()}>
                {t("web.vocabulary.start")}
              </Button>
            </SurfaceCard>
            {dueCount === 0 && (noneDue || (loaded && items.length > 0)) && <p role="status" data-testid="vocab-none-due" className="mx-0.5 text-meta text-ink-2">{t("web.vocabulary.noneDue")}</p>}
            {!loaded && <p className={PAGE_NOTE}>{t("web.common.loading")}</p>}
            {loaded && !items.length && !error && <p data-testid="vocab-empty" className={PAGE_NOTE}>{t("web.vocabulary.empty")}</p>}
            <Slot point="notebookViews" props={{}} />
            {items.length > 0 && (
              <SectionGroup title={t("web.vocabulary.all")} bare>
                <ul className={LIST_CARD}>
                  {items.map((i) => (
                    <li key={i.id} data-testid="vocab-item" className="flex min-h-row items-center gap-2 pl-3.5 pr-1">
                      <div className="min-w-0 flex-1 py-2.5">
                        <p {...lookupContext} className="truncate text-body font-medium tracking-[-0.005em] text-ink">{i.word}</p>
                        <p className="mt-0.5 truncate text-sub text-ink-2">{i.meaning || t("web.vocabulary.noMeaning")}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-ink-2">
                          <ToneBadge tone={isDue(i) ? "teal" : "gray"}>{t("web.vocabulary.box", { value: i.box })}</ToneBadge>
                          <span>{t("web.vocabulary.nextDue", { value: formatDateTime(i.dueAt) })}</span>
                        </p>
                      </div>
                      <IconButton label={t("web.common.delete")} data-testid="vocab-item-delete" className="text-ink-2"
                        onClick={() => setPendingDelete(i)}>
                        <Trash2Icon />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              </SectionGroup>
            )}
            {next && loaded && (
              <Button variant="ghost" data-testid="vocab-list-more" className="h-tap w-full text-blue"
                onClick={() => { const s = liveSignal(); if (s) void load(next, s); }}>{t("web.common.loadMore")}</Button>
            )}
          </>
        )}
      </div>
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className={LQ_DIALOG}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("web.vocabulary.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription className="break-words">{pendingDelete?.word}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={`h-11 ${LQ_SECONDARY}`}>{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="vocab-item-delete-confirm" className={`h-11 ${LQ_DANGER_TEXT}`}
              onClick={(e) => { e.preventDefault(); if (pendingDelete) void remove(pendingDelete); }}>{t("web.common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
