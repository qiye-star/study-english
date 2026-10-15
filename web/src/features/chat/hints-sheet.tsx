import { LoaderIcon, MicIcon, PencilIcon, SquareIcon, StarIcon, Volume2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { HINTS_SERVER_ERRORS } from "./hints";
import { BubbleAction, BubbleActions } from "./message-bubble";
import type { HintsState } from "./use-hints";
import type { TtsState } from "./use-tts-player";

export const hintKey = (index: number) => `hint-${index}`;

export function HintsSheet({ open, onOpenChange, state, onRetry, onFill, onSpeak, speakStates, onPractice, onSave }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  state: HintsState;
  onRetry(): void;
  onFill(text: string): void;
  onSpeak(index: number, text: string): void;
  speakStates: Record<string, TtsState>;
  onPractice(text: string): void;
  onSave(text: string): void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent data-testid="hints-sheet" className="max-h-[75dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.chat.hints.title")} description={t("web.chat.hints.description")} />
        <div data-testid="hints-result" data-status={state.status} aria-live="polite" className="space-y-2">
          {state.status === "loading" && (
            <div className="flex justify-center py-6 text-ink-2"><LoaderIcon className="h-5 w-5 animate-spin" aria-label={t("web.common.loading")} /></div>
          )}
          {state.status === "error" && (
            <div className="flex items-center gap-2 rounded-card bg-surface-2 py-1 pl-3.5 pr-1 text-sub text-red well liquid:rounded-inset">
              <p role="alert" className="flex-1">{translateServerError(t, state.error, HINTS_SERVER_ERRORS)}</p>
              <button type="button" data-testid="hints-retry" onClick={onRetry}
                className="inline-flex min-h-tap items-center rounded-button px-3 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("web.common.retry")}
              </button>
            </div>
          )}
          {state.status === "done" && (
            <ul className="space-y-2">
              {state.hints.map((hint, i) => {
                const speak = speakStates[hintKey(i)] ?? "idle";
                return (
                  <li key={i} data-testid="hint-item" className="rounded-card border-[0.5px] border-hair bg-surface px-3.5 pb-2 pt-3 shadow-card dark:shadow-none">
                    <p data-lookup-context className="select-text text-body font-medium leading-dialogue text-ink">{hint.text}</p>
                    <p className="mt-0.5 text-sub text-ink-2">{hint.zh}</p>
                    <BubbleActions>
                      <BubbleAction data-testid="hint-fill" className="text-blue" onClick={() => onFill(hint.text)}>
                        <PencilIcon aria-hidden />{t("web.chat.hints.fill")}
                      </BubbleAction>
                      <BubbleAction data-testid="hint-speak" data-state={speak} on={speak === "playing"}
                        aria-label={speak === "playing" ? t("web.chat.stopSpeaking") : t("web.chat.hints.speak")} onClick={() => onSpeak(i, hint.text)}>
                        {speak === "loading" ? <LoaderIcon aria-hidden className="animate-spin" /> : speak === "playing" ? <SquareIcon aria-hidden /> : <Volume2Icon aria-hidden />}
                      </BubbleAction>
                      <BubbleAction data-testid="hint-practice" aria-label={t("web.chat.hints.practice")} onClick={() => onPractice(hint.text)}>
                        <MicIcon aria-hidden />
                      </BubbleAction>
                      <BubbleAction data-testid="hint-save" aria-label={t("web.chat.hints.save")} onClick={() => onSave(hint.text)}>
                        <StarIcon aria-hidden />
                      </BubbleAction>
                    </BubbleActions>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
