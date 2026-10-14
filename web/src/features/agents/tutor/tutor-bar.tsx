import "./locales";
import { LanguagesIcon, LightbulbIcon, PlayIcon, SkipForwardIcon, Volume2Icon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { ToneBadge } from "~/components/tone-badge";
import { ZhNoteFold } from "~/components/zh-note-fold";
import { levelLabel } from "~/lib/levels";
import type { TutorSession } from "./tutor-api";

export interface TutorBarProps {
  session: TutorSession;
  hint: string | null;
  hintZh?: string | null;
  busy: boolean;
  onHint(): void;
  onSkip(): void;
  onListen(): void;
  onTranslate(): void;
  onEnd(): void;
  onResume(): void;
}

const CONFIRM_MS = 4000;

/** 图标在上、文字在下:英文「Translate」在 360 px 的四等分里也不会溢出。 */
function Action({ testId, label, icon, onClick, disabled }: { testId: string; label: string; icon: ReactNode; onClick(): void; disabled: boolean }) {
  return (
    <button type="button" data-testid={testId} disabled={disabled} onClick={onClick}
      className="inline-flex min-h-tap min-w-0 flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-button px-1 text-sub text-ink-2 transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40">
      <span aria-hidden className="inline-flex">{icon}</span>
      {label}
    </button>
  );
}

/** 输入栏上方的带学条:进度、题型、难度;提示 / 跳过 / 听一遍 / 翻译;结束(两次点击)。 */
export function TutorBar({ session, hint, hintZh, busy, onHint, onSkip, onListen, onTranslate, onEnd, onResume }: TutorBarProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);
  const waiting = session.phase === "await_answer";
  const speakFirst = session.phase === "opening" || session.phase === "ask";
  const answered = session.answers.length;
  const pct = session.stepsTotal ? Math.round((answered / session.stepsTotal) * 100) : 0;
  const end = () => {
    if (confirming) {
      setConfirming(false);
      onEnd();
    } else {
      setConfirming(true);
    }
  };
  return (
    <section data-testid="tutor-bar" aria-label={t("web.agents.tutor.bar.region")}
      className="mx-gutter mb-2 rounded-card border-[0.5px] border-hair bg-surface px-3 pb-1 pt-2 shadow-card dark:shadow-none">
      <div className="flex min-w-0 items-center gap-2">
        <ToneBadge tone="blue">{t("web.agents.tutor.bar.mode")}</ToneBadge>
        <span data-testid="tutor-progress" className="whitespace-nowrap text-sub font-semibold tabular-nums text-ink">
          {t("web.agents.tutor.bar.progress", { n: session.stepIndex, m: session.stepsTotal })}
        </span>
        {session.kind ? <span className="min-w-0 truncate text-sub text-ink-2">{t(`web.agents.tutor.kind.${session.kind}`)}</span> : null}
        <span className="ml-auto whitespace-nowrap text-meta text-ink-2" title={t("web.agents.tutor.bar.level", { level: session.level })}>{levelLabel(t, session.level)}</span>
        <button type="button" data-testid="tutor-end" onClick={end}
          className={cn("min-h-tap whitespace-nowrap rounded-button px-2 text-sub focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", confirming ? "font-semibold text-blue" : "text-ink-2")}>
          {confirming ? t("web.agents.tutor.bar.confirmEnd") : t("web.agents.tutor.bar.end")}
        </button>
      </div>
      <div role="progressbar" aria-label={t("web.agents.tutor.bar.region")} aria-valuemin={0} aria-valuemax={session.stepsTotal} aria-valuenow={answered}
        className="h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-1 rounded-full bg-blue transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
      {hint ? <p data-testid="tutor-hint" role="status" className="mt-2 rounded-[10px] bg-amber-tint px-2.5 py-1.5 text-sub text-amber">{hint}</p> : null}
      {hint && hintZh ? (
        <ZhNoteFold text={hintZh} showLabel={t("web.agents.tutor.bar.zhShow")} hideLabel={t("web.agents.tutor.bar.zhHide")} testId="tutor-hint-zh" className="mt-1" />
      ) : null}
      {speakFirst ? (
        <div className="mt-1 flex">
          <Action testId="tutor-resume" label={t("web.agents.tutor.bar.resume")} icon={<PlayIcon className="h-4 w-4" />} onClick={onResume} disabled={busy} />
        </div>
      ) : (
        <div className="mt-1 flex gap-1">
          <Action testId="tutor-hint-btn" label={t("web.agents.tutor.bar.hint")} icon={<LightbulbIcon className="h-4 w-4" />} onClick={onHint}
            disabled={busy || !waiting || session.hintsUsed >= session.hintsMax} />
          <Action testId="tutor-skip" label={t("web.agents.tutor.bar.skip")} icon={<SkipForwardIcon className="h-4 w-4" />} onClick={onSkip} disabled={busy || !waiting} />
          <Action testId="tutor-listen" label={t("web.agents.tutor.bar.listen")} icon={<Volume2Icon className="h-4 w-4" />} onClick={onListen} disabled={busy} />
          <Action testId="tutor-translate" label={t("web.agents.tutor.bar.translate")} icon={<LanguagesIcon className="h-4 w-4" />} onClick={onTranslate} disabled={busy} />
        </div>
      )}
    </section>
  );
}
