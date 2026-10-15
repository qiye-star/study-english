import { LoaderIcon, MicIcon, SquareIcon, StarIcon, Volume2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { cn } from "~/lib/cn";
import { LQ_INK, LQ_MARK, LQ_NOTE } from "~/components/liquid";
import { ScoreDot } from "~/components/score-dot";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { scoreToneClass } from "~/components/score-tone";
import { savePracticeItem, useShadowSheet } from "~/features/practice";
import type { StoredRecap } from "./chat-api";
import type { Level } from "./levels";
import { RECAP_SERVER_ERRORS, computeRecapFacts, generateRecap, isRecapStale } from "./recap";
import { BubbleAction } from "./message-bubble";
import type { UiMessage } from "./ui-message";
import type { TtsState } from "./use-tts-player";
import { lookupContext } from "~/lib/lookup-context";

/** Task 5.3 用它在条目上追加"加入词汇本"按钮 */
export interface RecapExtraActions {
  expression?(text: string, zh: string): ReactNode;
  poorWord?(word: string): ReactNode;
}

/** 朗读用的播放键(页面唯一的 TTS 播放器按键区分状态) */
export const recapSpeakKey = (kind: "grammar" | "word" | "expression", index: number) => `recap-${kind}-${index}`;

function IconAction({ testId, label, onClick, children }: { testId: string; label: string; onClick(): void; children: ReactNode }) {
  return <BubbleAction data-testid={testId} aria-label={label} onClick={onClick}>{children}</BubbleAction>;
}

const sectionTitle = "mb-2 text-sub font-semibold tracking-[0.01em] text-ink-2";
const outlineAction = "inline-flex min-h-tap flex-none items-center rounded-button px-3 text-sub font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function RecapSheet({ open, onOpenChange, messages, stored, level, scenarioId, onSave, onSpeak, speakStates, extraActions }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  messages: UiMessage[];
  stored: StoredRecap | null;
  level: Level;
  scenarioId: string | null;
  onSave(recap: StoredRecap): Promise<void>;
  /** 用页面唯一的 TTS 播放器朗读(再点一次停止) */
  onSpeak(key: string, text: string): void;
  speakStates: Record<string, TtsState>;
  extraActions?: RecapExtraActions;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const { open: openShadow } = useShadowSheet();
  const facts = useMemo(() => computeRecapFacts(messages), [messages]);
  const [local, setLocal] = useState<StoredRecap | null>(null); // 本次生成(可能未保存成功)
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllerRef.current?.abort();
    };
  }, []);
  // 关闭面板即中止进行中的生成(不自动重试)
  useEffect(() => {
    if (open) return;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus((s) => (s === "loading" ? "idle" : s));
  }, [open]);

  const recap = local ?? stored;
  const stale = !!recap && isRecapStale(recap, messages);

  const generate = async () => {
    if (controllerRef.current || !facts.userMessages) return; // 没有用户消息:不调用 AI
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("loading");
    setError(null);
    setNotSaved(false);
    try {
      const next = await generateRecap(api, { messages, level, scenarioId }, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setLocal(next);
      setStatus("idle");
      try {
        await onSave(next);
      } catch {
        if (mounted.current) setNotSaved(true); // 错误提示由 onSave(saveSettings)负责
      }
    } catch (err) {
      if (controller.signal.aborted || !mounted.current) return;
      setStatus("error");
      setError(translateServerError(t, err, RECAP_SERVER_ERRORS));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const practice = (text: string, source: "chat" | "grammar") => { onOpenChange(false); openShadow({ text, source }); };
  const speakButton = (testId: string, key: string, text: string) => {
    const state = speakStates[key] ?? "idle";
    return (
      <BubbleAction data-testid={testId} data-state={state} on={state === "playing"}
        aria-label={state === "playing" ? t("web.chat.stopSpeaking") : t("web.chat.recap.listen")} onClick={() => onSpeak(key, text)}>
        {state === "loading" ? <LoaderIcon aria-hidden className="animate-spin" /> : state === "playing" ? <SquareIcon aria-hidden /> : <Volume2Icon aria-hidden />}
      </BubbleAction>
    );
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent data-testid="recap-sheet" className="max-h-[85dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.chat.recap.title")} description={t("web.chat.recap.description")} />
        <section data-testid="recap-facts" className="space-y-section">
          {!facts.userMessages ? <p data-testid="recap-empty" className="rounded-card bg-surface-2 px-3.5 py-3 text-sub text-ink-2">{t("web.chat.recap.empty")}</p> : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-card border-[0.5px] border-hair-2 bg-surface-2 px-3 pb-2.5 pt-3">
                  <p className="text-meta font-medium text-ink-2">{t("web.chat.recap.userMessages")}</p>
                  <p data-testid="recap-user-messages" className="num mt-2 text-stat font-semibold text-ink">{facts.userMessages}</p>
                </div>
                <div className="rounded-card border-[0.5px] border-hair-2 bg-surface-2 px-3 pb-2.5 pt-3">
                  <p className="text-meta font-medium text-ink-2">{t("web.chat.recap.avgScore")}</p>
                  <p data-testid="recap-avg-score"
                    className={cn("num mt-2 text-stat font-semibold", facts.avgPronunciation == null ? "text-ink-2" : scoreToneClass(facts.avgPronunciation), LQ_INK)}>
                    {facts.avgPronunciation ?? "—"}
                    {facts.avgPronunciation != null && <ScoreDot score={facts.avgPronunciation} className="ml-1.5 align-middle" />}
                  </p>
                </div>
              </div>
              {facts.grammarCounts.length > 0 && (
                <div>
                  <h3 className={sectionTitle}>{t("web.chat.recap.grammar")}</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {facts.grammarCounts.map((c) => (
                      <span key={c.category} data-testid="recap-grammar-category"
                        className="num inline-flex h-[22px] items-center whitespace-nowrap rounded-[7px] bg-surface-2 px-2 text-meta font-semibold text-ink-2">
                        {t(`web.grammar.categories.${c.category}`, { defaultValue: t("web.grammar.categories.other") })} ×{c.count}
                      </span>
                    ))}
                  </div>
                  <ul className="mt-2 divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface">
                    {facts.grammarItems.map((g, i) => (
                      <li key={i} data-testid="recap-grammar-item" className="flex items-center gap-1 py-1.5 pl-3.5 pr-1.5">
                        <span data-lookup-context className="min-w-0 flex-1 select-text text-body">
                          <span className="text-ink-2 line-through">{g.original}</span> → <span className="font-semibold text-ink">{g.corrected}</span>
                          <span className="mt-0.5 block text-meta text-ink-2">{g.sentence}</span>
                        </span>
                        {speakButton("recap-grammar-speak", recapSpeakKey("grammar", i), g.sentence)}
                        <IconAction testId="recap-grammar-practice" label={t("web.chat.recap.practice")} onClick={() => practice(g.sentence, "grammar")}><MicIcon aria-hidden /></IconAction>
                        <IconAction testId="recap-grammar-save" label={t("web.chat.recap.save")} onClick={() => void savePracticeItem(api, t, g.sentence, "grammar")}><StarIcon aria-hidden /></IconAction>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {facts.poorWords.length > 0 && (
                <div>
                  <h3 className={sectionTitle}>{t("web.chat.recap.poorWords")}</h3>
                  <ul className="flex flex-wrap gap-2">
                    {facts.poorWords.map((w, i) => (
                      <li key={w} data-testid="recap-poor-word" className="flex items-center rounded-card border-[0.5px] border-hair bg-surface pl-3">
                        <span {...lookupContext} className={`mr-1 rounded-[4px] bg-amber-tint px-[3px] text-body font-medium text-amber ${LQ_MARK}`}>{w}</span>
                        {speakButton("recap-poor-word-speak", recapSpeakKey("word", i), w)}
                        <IconAction testId="recap-poor-word-practice" label={t("web.chat.recap.practice")} onClick={() => practice(w, "chat")}><MicIcon aria-hidden /></IconAction>
                        <IconAction testId="recap-poor-word-save" label={t("web.chat.recap.save")} onClick={() => void savePracticeItem(api, t, w, "chat")}><StarIcon aria-hidden /></IconAction>
                        {extraActions?.poorWord?.(w)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
        <section aria-live="polite" className="mt-section space-y-2.5 pb-1">
          <h3 className={sectionTitle}>{t("web.chat.recap.summary")}</h3>
          {status === "error" && (
            <div className="flex items-center gap-2 rounded-card bg-surface-2 py-1 pl-3.5 pr-1 text-sub text-red well liquid:rounded-inset">
              <p role="alert" data-testid="recap-error" className="flex-1">{error}</p>
              <button type="button" data-testid="recap-retry" className={outlineAction} onClick={() => void generate()}>{t("web.common.retry")}</button>
            </div>
          )}
          {status === "loading" && (
            <p data-testid="recap-summary" data-status="loading" className="flex justify-center py-4 text-ink-2">
              <LoaderIcon className="h-5 w-5 animate-spin" aria-label={t("web.common.loading")} />
            </p>
          )}
          {status !== "loading" && recap && (
            <>
              {stale && (
                <div data-testid="recap-stale" className={`flex items-center gap-2 rounded-card bg-amber-tint py-1 pl-3.5 pr-1 text-sub text-ink ${LQ_NOTE}`}>
                  <span className="flex-1">{t("web.chat.recap.stale")}</span>
                  <button type="button" data-testid="recap-regenerate" className={outlineAction} onClick={() => void generate()}>{t("web.chat.recap.regenerate")}</button>
                </div>
              )}
              {notSaved && <p data-testid="recap-not-saved" className="text-meta text-red">{t("web.chat.recap.notSaved")}</p>}
              <p data-testid="recap-summary" data-status="done" className="whitespace-pre-wrap text-body leading-dialogue text-ink">{recap.summaryZh}</p>
              {recap.newExpressions.length > 0 && (
                <ul className="divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface">
                  {recap.newExpressions.map((e, i) => (
                    <li key={i} data-testid="recap-expression" className="flex items-center gap-1 py-1.5 pl-3.5 pr-1.5">
                      <span data-lookup-context className="min-w-0 flex-1 select-text">
                        <span className="block text-body font-semibold text-ink">{e.text}</span>
                        <span className="mt-0.5 block text-meta text-ink-2">{e.zh}</span>
                      </span>
                      {speakButton("recap-expression-speak", recapSpeakKey("expression", i), e.text)}
                      <IconAction testId="recap-expression-practice" label={t("web.chat.recap.practice")} onClick={() => practice(e.text, "chat")}><MicIcon aria-hidden /></IconAction>
                      <IconAction testId="recap-expression-save" label={t("web.chat.recap.save")} onClick={() => void savePracticeItem(api, t, e.text, "chat")}><StarIcon aria-hidden /></IconAction>
                      {extraActions?.expression?.(e.text, e.zh)}
                    </li>
                  ))}
                </ul>
              )}
              {recap.suggestionsZh.map((s, i) => <p key={i} data-testid="recap-suggestion" className="text-sub leading-dialogue text-ink">· {s}</p>)}
            </>
          )}
          {status === "idle" && !recap && (
            <Button data-testid="recap-generate" className="h-12 w-full rounded-button text-body font-semibold" disabled={!facts.userMessages} onClick={() => void generate()}>
              {t("web.chat.recap.generate")}
            </Button>
          )}
          <p className="text-meta text-ink-2">{t("web.chat.recap.costNote")}</p>
        </section>
      </BottomSheetContent>
    </BottomSheet>
  );
}
