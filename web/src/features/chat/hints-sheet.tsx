import { LoaderIcon, MicIcon, PencilIcon, SquareIcon, StarIcon, Volume2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@renderer/components/ui/sheet";
import { translateServerError } from "~/api/error-messages";
import { BottomSheet, BottomSheetContent } from "~/components/bottom-sheet";
import { HINTS_SERVER_ERRORS } from "./hints";
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
      <BottomSheetContent data-testid="hints-sheet" className="max-h-[75dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle className="text-left">{t("web.chat.hints.title")}</SheetTitle>
          <SheetDescription className="text-left">{t("web.chat.hints.description")}</SheetDescription>
        </SheetHeader>
        <div data-testid="hints-result" data-status={state.status} aria-live="polite" className="mt-3 space-y-3">
          {state.status === "loading" && <LoaderIcon className="h-5 w-5 animate-spin" aria-label={t("web.common.loading")} />}
          {state.status === "error" && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <p role="alert" className="flex-1">{translateServerError(t, state.error, HINTS_SERVER_ERRORS)}</p>
              <Button variant="outline" data-testid="hints-retry" className="h-11" onClick={onRetry}>{t("web.common.retry")}</Button>
            </div>
          )}
          {state.status === "done" && (
            <ul className="space-y-3">
              {state.hints.map((hint, i) => {
                const speak = speakStates[hintKey(i)] ?? "idle";
                return (
                  <li key={i} data-testid="hint-item" className="rounded-md border p-3">
                    <p data-lookup-context className="select-text text-base">{hint.text}</p>
                    <p className="text-sm text-muted-foreground">{hint.zh}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Button variant="ghost" size="sm" data-testid="hint-fill" className="h-11 px-2" onClick={() => onFill(hint.text)}>
                        <PencilIcon className="mr-1 h-4 w-4" />{t("web.chat.hints.fill")}
                      </Button>
                      <Button variant="ghost" size="sm" data-testid="hint-speak" data-state={speak} className="h-11 min-w-11 px-2"
                        aria-label={speak === "playing" ? t("web.chat.stopSpeaking") : t("web.chat.hints.speak")} onClick={() => onSpeak(i, hint.text)}>
                        {speak === "loading" ? <LoaderIcon className="h-4 w-4 animate-spin" /> : speak === "playing" ? <SquareIcon className="h-4 w-4" /> : <Volume2Icon className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" data-testid="hint-practice" className="h-11 min-w-11 px-2"
                        aria-label={t("web.chat.hints.practice")} onClick={() => onPractice(hint.text)}>
                        <MicIcon className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" data-testid="hint-save" className="h-11 min-w-11 px-2"
                        aria-label={t("web.chat.hints.save")} onClick={() => onSave(hint.text)}>
                        <StarIcon className="h-4 w-4" />
                      </Button>
                    </div>
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
