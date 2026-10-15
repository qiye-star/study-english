import { LoaderIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { LQ_ICON_WELL } from "~/components/liquid";
import { SurfaceCard } from "~/components/surface-card";
import type { TtsState } from "~/features/chat";
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
  const flipRef = useRef<HTMLButtonElement>(null);
  const meaningRef = useRef<HTMLParagraphElement>(null);
  // 翻面 / 换卡时原来的按钮会被卸载:把焦点交给下一个该操作的位置,键盘用户不必从页首重新 Tab
  useEffect(() => {
    (flipped ? meaningRef.current : flipRef.current)?.focus();
  }, [item.id, flipped]);
  return (
    <SurfaceCard data-testid="vocab-card" className="space-y-3 p-3.5">
      <p data-testid="vocab-review-progress" aria-live="polite" className="eyebrow num">{t("web.vocabulary.progress", { position, total })}</p>
      <div className="flex items-center gap-2">
        <p data-testid="vocab-card-word" data-lookup-context className="min-w-0 flex-1 select-text break-words text-headline font-semibold text-ink">{item.word}</p>
        <button type="button" data-testid="vocab-card-speak" data-state={speakState} aria-label={t("web.vocabulary.speak")} disabled={!canSpeak} onClick={onSpeak}
          className={`flex h-tap w-tap flex-none items-center justify-center rounded-full bg-teal-tint text-teal transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 ${LQ_ICON_WELL}`}>
          {speakState === "loading" ? <LoaderIcon className="animate-spin" /> : speakState === "playing" ? <SquareIcon /> : <Volume2Icon />}
        </button>
      </div>
      {flipped ? (
        <div className="space-y-3">
          <p ref={meaningRef} tabIndex={-1} data-testid="vocab-card-meaning" className="text-body text-ink outline-none">{item.meaning || t("web.vocabulary.noMeaning")}</p>
          {item.example && <p data-testid="vocab-card-example" data-lookup-context className="select-text text-sub leading-dialogue text-ink-2">{item.example}</p>}
          <div className="grid grid-cols-3 gap-2">
            {GRADES.map((g) => (
              <Button key={g} data-testid={`vocab-grade-${g}`} variant={g === "good" ? "default" : "outline"} className="h-12 rounded-button font-semibold"
                disabled={grading} onClick={() => onGrade(g)}>{t(`web.vocabulary.grades.${g}`)}</Button>
            ))}
          </div>
        </div>
      ) : (
        <Button ref={flipRef} data-testid="vocab-card-flip" className="h-12 w-full rounded-button font-semibold" onClick={onFlip}>{t("web.vocabulary.flip")}</Button>
      )}
    </SurfaceCard>
  );
}
