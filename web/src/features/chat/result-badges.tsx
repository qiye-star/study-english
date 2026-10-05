import { LoaderIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import type { AssessmentView } from "./ui-message";

export function scoreTone(score: number): string {
  return score >= 80 ? "bg-emerald-600 text-white" : score >= 60 ? "bg-amber-500 text-white" : "bg-red-600 text-white";
}

export function PronunciationBadge({ view, onOpen }: { view?: AssessmentView; onOpen(): void }) {
  const { t } = useTranslation();
  if (!view) return null;
  const score = view.status === "done" && view.scores ? Math.round(view.scores.pronunciationScore) : null;
  const label = view.status === "pending" ? t("web.chat.voice.assessing")
    : view.status === "error" ? t("web.chat.voice.assessFailed")
    : view.status === "skipped" ? t(view.reason === "too-long" ? "web.chat.voice.skippedTooLong" : "web.chat.voice.skippedNonEnglish")
    : t("web.chat.voice.score", { score });
  return (
    <button type="button" data-testid="badge-pronunciation" data-status={view.status} data-score={score ?? undefined}
      disabled={view.status !== "done"} onClick={onOpen} className="inline-flex min-h-11 items-center px-1">
      <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs",
        score === null ? "bg-muted text-muted-foreground" : scoreTone(score))}>
        {view.status === "pending" && <LoaderIcon className="h-3 w-3 animate-spin" />}
        {label}
      </span>
    </button>
  );
}
