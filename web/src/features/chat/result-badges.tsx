import { LoaderIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "./cn";
import { translateServerError } from "~/api/error-messages";
import { scoreBadgeTone } from "~/components/score-tone";
import { TONE_CLASS, type Tone } from "~/components/tone";
import { CHAT_SERVER_ERRORS } from "./chat-api";
import { GRAMMAR_SERVER_ERRORS } from "~/features/grammar/grammar-api";
import { mayHaveMixedVoices } from "./mixed-voices";
import type { AssessmentView, GrammarView } from "./ui-message";

/**
 * 旧的实底分数色(通话字幕还在用,通话界面由 realtime 自己迁到 ~/components/score-tone)。
 * 对话页的徽标改用 redesign 的分数刻度(≥85 绿 / 70–84 琥珀 / 其余中性)。
 */
export function scoreTone(score: number): string {
  return score >= 80 ? "bg-emerald-600 text-white" : score >= 60 ? "bg-amber-500 text-white" : "bg-red-600 text-white";
}

/** 22px 高的徽标;按钮命中区向上下各扩 11px 到 44px,不撑高气泡。 */
const badgeButton = "relative inline-flex items-center rounded-[7px] before:absolute before:inset-x-0 before:-inset-y-[11px] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default";

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-[7px] px-2 text-meta font-semibold tracking-[0.01em] num", TONE_CLASS[tone])}>
      {children}
    </span>
  );
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
    <>
      <button type="button" data-testid="badge-pronunciation" data-status={view.status} data-score={score ?? undefined}
        title={reason} aria-label={reason ? `${label}: ${reason}` : undefined}
        disabled={view.status !== "done"} onClick={onOpen} className={badgeButton}>
        <Badge tone={score === null ? "gray" : scoreBadgeTone(score)}>
          {view.status === "pending" && <LoaderIcon className="h-3 w-3 animate-spin" aria-hidden />}
          {label}
        </Badge>
      </button>
      {mixed && <span data-testid="voice-mixed-hint" role="note" className="basis-full text-meta text-amber">{t("web.chat.voice.mixedVoices")}</span>}
    </>
  );
}

/** 语法是计数,不是分数:始终中性色(redesign:语法 1 处为中性)。失败时点一下重试。 */
export function GrammarBadge({ view, onOpen, onRetry }: { view?: GrammarView; onOpen(): void; onRetry(): void }) {
  const { t } = useTranslation();
  if (!view || view.status === "skipped") return null;
  const count = view.result?.errors.length ?? 0;
  const label = view.status === "pending" ? t("web.grammar.checking")
    : view.status === "error" ? t("web.grammar.failed")
    : count ? t("web.grammar.issues", { count }) : t("web.grammar.ok");
  return (
    <button type="button" data-testid="badge-grammar" data-status={view.status} data-errors={view.status === "done" ? count : undefined}
      title={view.status === "error" ? translateServerError(t, view.error, GRAMMAR_SERVER_ERRORS) : undefined}
      disabled={view.status === "pending"} onClick={view.status === "error" ? onRetry : onOpen}
      className={badgeButton}>
      <Badge tone="gray">
        {view.status === "pending" && <LoaderIcon className="h-3 w-3 animate-spin" aria-hidden />}
        {label}
      </Badge>
    </button>
  );
}
