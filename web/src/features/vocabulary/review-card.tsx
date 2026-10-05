import { LoaderIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import type { TtsState } from "~/features/chat/use-tts-player";
import type { VocabularyGrade, VocabularyItem } from "./vocabulary-api";

const GRADES: VocabularyGrade[] = ["forgot", "hard", "good"];

export function ReviewCard({ item, position, total, flipped, grading, speakState, canSpeak, onFlip, onGrade, onSpeak }: {
  item: VocabularyItem;
  position: number;
  total: number;
  flipped: boolean;
  grading: boolean;
  speakState: TtsState;
  canSpeak: boolean;
  onFlip(): void;
  onGrade(grade: VocabularyGrade): void;
  onSpeak(): void;
}) {
  const { t } = useTranslation();
  return (
    <div data-testid="vocab-card" className="space-y-3 rounded-xl border p-4">
      <p data-testid="vocab-review-progress" className="text-xs text-muted-foreground">{t("web.vocabulary.progress", { position, total })}</p>
      <div className="flex items-center gap-2">
        <p data-testid="vocab-card-word" data-lookup-context className="min-w-0 flex-1 select-text break-words text-2xl font-semibold">{item.word}</p>
        <Button variant="ghost" size="icon" data-testid="vocab-card-speak" data-state={speakState} className="h-11 w-11 shrink-0"
          aria-label={t("web.vocabulary.speak")} disabled={!canSpeak} onClick={onSpeak}>
          {speakState === "loading" ? <LoaderIcon className="h-5 w-5 animate-spin" /> : speakState === "playing" ? <SquareIcon className="h-5 w-5" /> : <Volume2Icon className="h-5 w-5" />}
        </Button>
      </div>
      {flipped ? (
        <div className="space-y-2">
          <p data-testid="vocab-card-meaning" className="text-base">{item.meaning || t("web.vocabulary.noMeaning")}</p>
          {item.example && <p data-testid="vocab-card-example" data-lookup-context className="select-text text-sm text-muted-foreground">{item.example}</p>}
          <div className="grid grid-cols-3 gap-2">
            {GRADES.map((g) => (
              <Button key={g} data-testid={`vocab-grade-${g}`} variant={g === "good" ? "default" : "outline"} className="h-11"
                disabled={grading} onClick={() => onGrade(g)}>{t(`web.vocabulary.grades.${g}`)}</Button>
            ))}
          </div>
        </div>
      ) : (
        <Button data-testid="vocab-card-flip" className="h-11 w-full" onClick={onFlip}>{t("web.vocabulary.flip")}</Button>
      )}
    </div>
  );
}
