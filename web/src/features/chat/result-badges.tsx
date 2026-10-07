import { LoaderIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { CHAT_SERVER_ERRORS } from "./chat-api";
import { GRAMMAR_SERVER_ERRORS } from "~/features/grammar/grammar-api";
import { mayHaveMixedVoices } from "./mixed-voices";
import type { AssessmentView, GrammarView } from "./ui-message";

export function scoreTone(score: number): string {
  return score >= 80 ? "bg-emerald-600 text-white" : score >= 60 ? "bg-amber-500 text-white" : "bg-red-600 text-white";
}

export function PronunciationBadge({ view, transcript, onOpen }: { view?: AssessmentView; transcript?: string; onOpen(): void }) {
  const { t } = useTranslation();
  if (!view) return null;
  const score = view.status === "done" && view.scores ? Math.round(view.scores.pronunciationScore) : null;
  const label = view.status === "pending" ? t("web.chat.voice.assessing")
    : view.status === "error" ? t("web.chat.voice.assessFailed")
    : view.status === "skipped" ? t(view.reason === "too-long" ? "web.chat.voice.skippedTooLong" : "web.chat.voice.skippedNonEnglish")
    : t("web.chat.voice.score", { score });
  const reason = view.status === "error" ? translateServerError(t, view.error, CHAT_SERVER_ERRORS) : undefined;
  const mixed = view.status === "done" && mayHaveMixedVoices(view.scores?.pronunciationScore, transcript ?? "", (view.words ?? []).map((w) => w.word));
  return (
    <span className="inline-flex items-center">
      <button type="button" data-testid="badge-pronunciation" data-status={view.status} data-score={score ?? undefined}
        title={reason} aria-label={reason ? `${label}: ${reason}` : undefined}
        disabled={view.status !== "done"} onClick={onOpen} className="inline-flex min-h-11 items-center px-1">
        <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs",
          score === null ? "bg-muted text-muted-foreground" : scoreTone(score))}>
          {view.status === "pending" && <LoaderIcon className="h-3 w-3 animate-spin" />}
          {label}
        </span>
      </button>
      {mixed && <span data-testid="voice-mixed-hint" role="note" className="text-xs text-amber-700">{t("web.chat.voice.mixedVoices")}</span>}
    </span>
  );
}

export function GrammarBadge({ view, onOpen, onRetry }: { view?: GrammarView; onOpen(): void; onRetry(): void }) {
  const { t } = useTranslation();
  if (!view || view.status === "skipped") return null;
  const count = view.result?.errors.length ?? 0;
  const label = view.status === "pending" ? t("web.grammar.checking")
    : view.status === "error" ? t("web.grammar.failed")
    : count ? t("web.grammar.issues", { count }) : t("web.grammar.ok");
  const tone = view.status !== "done" ? "bg-muted text-muted-foreground" : count ? "bg-amber-500 text-white" : "bg-emerald-600 text-white";
  return (
    <button type="button" data-testid="badge-grammar" data-status={view.status} data-errors={view.status === "done" ? count : undefined}
      title={view.status === "error" ? translateServerError(t, view.error, GRAMMAR_SERVER_ERRORS) : undefined}
      disabled={view.status === "pending"} onClick={view.status === "error" ? onRetry : onOpen}
      className="inline-flex min-h-11 items-center px-1">
      <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs", tone)}>
        {view.status === "pending" && <LoaderIcon className="h-3 w-3 animate-spin" />}
        {label}
      </span>
    </button>
  );
}
