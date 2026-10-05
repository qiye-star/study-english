import { LoaderIcon, MicIcon, SquareIcon, StarIcon, Volume2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@renderer/components/ui/sheet";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent } from "~/components/bottom-sheet";
import { goPractice, savePracticeItem } from "~/features/practice/save-practice-item";
import type { StoredRecap } from "./chat-api";
import type { Level } from "./levels";
import { RECAP_SERVER_ERRORS, computeRecapFacts, generateRecap, isRecapStale } from "./recap";
import type { UiMessage } from "./ui-message";
import type { TtsState } from "./use-tts-player";

/** Task 5.3 用它在条目上追加"加入词汇本"按钮 */
export interface RecapExtraActions {
  expression?(text: string, zh: string): ReactNode;
  poorWord?(word: string): ReactNode;
}

/** 朗读用的播放键(页面唯一的 TTS 播放器按键区分状态) */
export const recapSpeakKey = (kind: "grammar" | "word" | "expression", index: number) => `recap-${kind}-${index}`;

function IconAction({ testId, label, onClick, children }: { testId: string; label: string; onClick(): void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" data-testid={testId} className="h-11 min-w-11 px-2" aria-label={label} onClick={onClick}>{children}</Button>
  );
}

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
  const navigate = useNavigate();
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

  const practice = (text: string) => { onOpenChange(false); goPractice(navigate, text); };
  const speakButton = (testId: string, key: string, text: string) => {
    const state = speakStates[key] ?? "idle";
    return (
      <Button variant="ghost" size="sm" data-testid={testId} data-state={state} className="h-11 min-w-11 px-2"
        aria-label={state === "playing" ? t("web.chat.stopSpeaking") : t("web.chat.recap.listen")} onClick={() => onSpeak(key, text)}>
        {state === "loading" ? <LoaderIcon className="h-4 w-4 animate-spin" /> : state === "playing" ? <SquareIcon className="h-4 w-4" /> : <Volume2Icon className="h-4 w-4" />}
      </Button>
    );
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent data-testid="recap-sheet" className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle className="text-left">{t("web.chat.recap.title")}</SheetTitle>
          <SheetDescription className="text-left">{t("web.chat.recap.description")}</SheetDescription>
        </SheetHeader>
        <section data-testid="recap-facts" className="mt-3 space-y-2 text-sm">
          {!facts.userMessages ? <p data-testid="recap-empty" className="text-muted-foreground">{t("web.chat.recap.empty")}</p> : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">{t("web.chat.recap.userMessages")}</p>
                  <p data-testid="recap-user-messages" className="text-lg font-semibold tabular-nums">{facts.userMessages}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">{t("web.chat.recap.avgScore")}</p>
                  <p data-testid="recap-avg-score" className="text-lg font-semibold tabular-nums">{facts.avgPronunciation ?? "—"}</p>
                </div>
              </div>
              {facts.grammarCounts.length > 0 && (
                <div>
                  <p className="font-medium">{t("web.chat.recap.grammar")}</p>
                  <div className="flex flex-wrap gap-1">
                    {facts.grammarCounts.map((c) => (
                      <span key={c.category} data-testid="recap-grammar-category" className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {t(`web.grammar.categories.${c.category}`, { defaultValue: t("web.grammar.categories.other") })} ×{c.count}
                      </span>
                    ))}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {facts.grammarItems.map((g, i) => (
                      <li key={i} data-testid="recap-grammar-item" className="flex items-center gap-1">
                        <span data-lookup-context className="min-w-0 flex-1 select-text">
                          <span className="line-through">{g.original}</span> → <span className="font-medium">{g.corrected}</span>
                          <span className="block text-xs text-muted-foreground">{g.sentence}</span>
                        </span>
                        {speakButton("recap-grammar-speak", recapSpeakKey("grammar", i), g.sentence)}
                        <IconAction testId="recap-grammar-practice" label={t("web.chat.recap.practice")} onClick={() => practice(g.sentence)}><MicIcon className="h-4 w-4" /></IconAction>
                        <IconAction testId="recap-grammar-save" label={t("web.chat.recap.save")} onClick={() => void savePracticeItem(api, t, g.sentence, "grammar")}><StarIcon className="h-4 w-4" /></IconAction>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {facts.poorWords.length > 0 && (
                <div>
                  <p className="font-medium">{t("web.chat.recap.poorWords")}</p>
                  <ul className="flex flex-wrap gap-1">
                    {facts.poorWords.map((w, i) => (
                      <li key={w} data-testid="recap-poor-word" className="flex items-center rounded-md border pl-2">
                        <span>{w}</span>
                        {speakButton("recap-poor-word-speak", recapSpeakKey("word", i), w)}
                        <IconAction testId="recap-poor-word-practice" label={t("web.chat.recap.practice")} onClick={() => practice(w)}><MicIcon className="h-4 w-4" /></IconAction>
                        <IconAction testId="recap-poor-word-save" label={t("web.chat.recap.save")} onClick={() => void savePracticeItem(api, t, w, "chat")}><StarIcon className="h-4 w-4" /></IconAction>
                        {extraActions?.poorWord?.(w)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
        <section aria-live="polite" className="mt-4 space-y-2 text-sm">
          <p className="font-medium">{t("web.chat.recap.summary")}</p>
          {status === "error" && (
            <div className="flex items-center gap-2 text-destructive">
              <p role="alert" data-testid="recap-error" className="flex-1">{error}</p>
              <Button variant="outline" data-testid="recap-retry" className="h-11" onClick={() => void generate()}>{t("web.common.retry")}</Button>
            </div>
          )}
          {status === "loading" && <p data-testid="recap-summary" data-status="loading"><LoaderIcon className="h-5 w-5 animate-spin" aria-label={t("web.common.loading")} /></p>}
          {status !== "loading" && recap && (
            <>
              {stale && (
                <div data-testid="recap-stale" className="flex items-center gap-2 rounded-md bg-muted p-2">
                  <span className="flex-1">{t("web.chat.recap.stale")}</span>
                  <Button variant="outline" data-testid="recap-regenerate" className="h-11" onClick={() => void generate()}>{t("web.chat.recap.regenerate")}</Button>
                </div>
              )}
              {notSaved && <p data-testid="recap-not-saved" className="text-xs text-destructive">{t("web.chat.recap.notSaved")}</p>}
              <p data-testid="recap-summary" data-status="done" className="whitespace-pre-wrap">{recap.summaryZh}</p>
              {recap.newExpressions.length > 0 && (
                <ul className="space-y-1">
                  {recap.newExpressions.map((e, i) => (
                    <li key={i} data-testid="recap-expression" className="flex items-center gap-1">
                      <span data-lookup-context className="min-w-0 flex-1 select-text"><span className="font-medium">{e.text}</span> <span className="text-muted-foreground">{e.zh}</span></span>
                      {speakButton("recap-expression-speak", recapSpeakKey("expression", i), e.text)}
                      <IconAction testId="recap-expression-practice" label={t("web.chat.recap.practice")} onClick={() => practice(e.text)}><MicIcon className="h-4 w-4" /></IconAction>
                      <IconAction testId="recap-expression-save" label={t("web.chat.recap.save")} onClick={() => void savePracticeItem(api, t, e.text, "chat")}><StarIcon className="h-4 w-4" /></IconAction>
                      {extraActions?.expression?.(e.text, e.zh)}
                    </li>
                  ))}
                </ul>
              )}
              {recap.suggestionsZh.map((s, i) => <p key={i} data-testid="recap-suggestion">· {s}</p>)}
            </>
          )}
          {status === "idle" && !recap && (
            <Button data-testid="recap-generate" className="h-11 w-full" disabled={!facts.userMessages} onClick={() => void generate()}>
              {t("web.chat.recap.generate")}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t("web.chat.recap.costNote")}</p>
        </section>
      </BottomSheetContent>
    </BottomSheet>
  );
}
