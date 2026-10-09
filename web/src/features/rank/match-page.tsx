import { CircleIcon, EyeIcon, EyeOffIcon, LoaderIcon, RotateCcwIcon, UserRoundIcon, Volume2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { HoldToTalkBar } from "~/components/hold-to-talk-bar";
import { ToneBadge } from "~/components/tone-badge";
import { goPractice, savePracticeItem } from "~/features/practice";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import { MatchResult } from "./match-result";
import type { Match } from "./rank-api";
import { formatCountdown, userTurns } from "./tiers";
import { CARD, GHOST_BUTTON, PRIMARY_BUTTON } from "./ui";
import { MAX_HOLD_MS, useMatch } from "./use-match";

const LIVE_PHASES = new Set(["ai_speaking", "your_turn", "recording", "uploading"]);
const TOOL = "inline-flex min-h-tap items-center gap-[5px] rounded-button px-1 text-sub font-medium text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:size-[18px]";

const matchMinutes = (match: Match) => Math.max(1, Math.round((Date.parse(match.expiresAt) - Date.parse(match.startedAt)) / 60_000)) || 20;

/** 情景卡:情景名 + 目标段位 + 目标清单(进行中不勾选、不显示分数;设计稿 R2)。 */
function ScenarioCard({ match }: { match: Match }) {
  const { t } = useTranslation();
  return (
    <div data-testid="match-brief" className={cn("px-3.5 py-3", CARD)}>
      <div className="flex items-center justify-between gap-2">
        <b className="text-body font-semibold">{match.scenario.titleZh}</b>
        <ToneBadge tone="gray">{t("web.rank.match.target", { tier: t(`web.rank.tiers.${match.toTier}`) })}</ToneBadge>
      </div>
      <ul className="mt-2 grid gap-1 text-sub text-ink-2">
        {match.scenario.functions.map((f) => (
          <li key={f} className="flex items-center gap-1.5"><CircleIcon aria-hidden className="size-3.5 flex-none" />{f}</li>
        ))}
      </ul>
    </div>
  );
}

/** 晋级赛(spec §10.2、设计稿 R2):只收语音;考官最新一句默认只播放不显示(「看文字」可开)。 */
export function MatchPage() {
  const { id = "" } = useParams();
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const m = useMatch(id);
  const { phase, match, verdict, error, showText } = m.state;
  const [now, setNow] = useState(() => Date.now());
  const live = LIVE_PHASES.has(phase);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  if (phase === "result" && match) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title={t("web.rank.match.title")} back="/rank" />
        <MatchResult match={match} verdict={verdict}
          onDrill={(text) => void savePracticeItem(api, t, text, "manual").finally(() => goPractice(navigate, text))} />
      </div>
    );
  }
  const turn = match ? Math.min(userTurns(match) + 1, match.turnLimit) : 0;
  const subtitle = match && live
    ? <span className="tabular-nums">{`${t("web.rank.match.turn", { n: turn, total: match.turnLimit })} · ${t("web.rank.match.timeLeft", { time: formatCountdown(Date.parse(match.expiresAt) - now) })}`}</span>
    : undefined;
  const lastIndex = match ? match.turns.length - 1 : -1;
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.rank.match.title")} back="/rank" subtitle={subtitle} />
      <div data-testid="match-turns" data-phase={phase} className="flex flex-1 flex-col justify-end gap-3 px-gutter pb-3.5 pt-2">
        {phase === "loading" && (
          <p className="flex justify-center py-16 text-ink-2"><LoaderIcon className="size-5 animate-spin" aria-label={t("web.common.loading")} /></p>
        )}
        {match && phase !== "briefing" && <ScenarioCard match={match} />}
        {match && phase !== "briefing" && match.turns.map((item, i) => item.role === "ai" ? (
          <div key={i} data-testid="match-ai-line"
            className="max-w-[88%] self-start rounded-card rounded-tl-inline border-[0.5px] border-hair bg-surface px-3 py-2.5 text-body leading-dialogue">
            <div className="mb-[3px] flex items-center gap-1.5 text-label font-semibold uppercase tracking-eyebrow text-ink-2">
              {i === lastIndex && phase === "ai_speaking" ? <Volume2Icon aria-hidden className="size-3.5" /> : <UserRoundIcon aria-hidden className="size-3.5" />}
              {i === lastIndex && phase === "ai_speaking" ? `${t("web.rank.match.partner")} · ${t("web.rank.match.speaking")}` : t("web.rank.match.partner")}
            </div>
            {showText || i < lastIndex ? <p>{item.text}</p> : <p aria-hidden className="tracking-[0.3em] text-ink-2">· · ·</p>}
          </div>
        ) : (
          <div key={i} data-testid="match-user-line"
            className="max-w-[88%] self-end rounded-card rounded-tr-inline bg-blue-tint px-3 py-2.5 text-body leading-dialogue text-ink">
            {item.text}
          </div>
        ))}
        {phase === "grading" && (
          <p className="flex items-center justify-center gap-2 py-6 text-sub text-ink-2"><LoaderIcon aria-hidden className="size-4 animate-spin" />{t("web.rank.match.grading")}</p>
        )}
        {phase === "error" && (
          <div role="alert" data-testid="match-error" className={cn("p-3.5 text-sub", CARD)}>
            <p>{error}</p>
            <button type="button" className={cn(GHOST_BUTTON, "mt-3 h-tap")} onClick={m.retry}>
              <RotateCcwIcon aria-hidden />{t("web.rank.match.retry")}
            </button>
          </div>
        )}
      </div>
      {match && live && (
        <div data-testid="match-dock" className="glass glass-edge-t sticky bottom-0 z-30 px-3 pb-2 pt-1.5">
          <div className="mb-1 flex justify-between">
            <button type="button" className={TOOL} disabled={phase !== "your_turn"} onClick={m.replay}>
              <Volume2Icon aria-hidden />{t("web.rank.match.replay")}
            </button>
            <button type="button" data-testid="match-toggle-text" aria-pressed={showText} className={TOOL} onClick={m.toggleText}>
              {showText ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}{t(showText ? "web.rank.match.hideText" : "web.rank.match.showText")}
            </button>
            <button type="button" data-testid="match-abandon" className={TOOL} disabled={phase === "recording" || phase === "uploading"}
              onClick={() => { if (window.confirm(t("web.rank.match.abandonConfirm"))) void m.abandon(); }}>
              {t("web.rank.match.abandon")}
            </button>
          </div>
          <div className="flex">
            <HoldToTalkBar testId="match-hold" tone="blue" disabled={phase !== "your_turn" && phase !== "recording"}
              live={phase === "recording"} busy={phase === "uploading"} busyLabel={t("web.rank.match.listening")}
              idleLabel={t("web.rank.match.hold")} maxHoldMs={MAX_HOLD_MS}
              // 只收语音(spec §3.5):不提供「转文字」落点,上滑只能取消
              allowToText={false}
              onStart={m.press}
              onFinish={() => m.release()}
              onDiscard={() => m.cancel()}
              onRelease={m.prime} />
          </div>
        </div>
      )}
      <BottomSheet open={phase === "briefing" && !!match} onOpenChange={(open) => { if (!open) navigate("/rank"); }}>
        <BottomSheetContent>
          {match && (
            <>
              <BottomSheetHeader title={match.scenario.titleZh} description={match.scenario.briefZh} />
              <div data-testid="match-briefing" className="pb-2">
                <p className="text-sub font-semibold text-ink-2">{t("web.rank.match.goals")}</p>
                <ul className="mt-2 grid gap-1.5 text-body">
                  {match.scenario.functions.map((f) => (
                    <li key={f} className="flex items-center gap-2"><CircleIcon aria-hidden className="size-3.5 flex-none text-ink-3" />{f}</li>
                  ))}
                </ul>
                <p className="mt-3 text-meta text-ink-2">{t("web.rank.match.rules", { turns: match.turnLimit, minutes: matchMinutes(match) })}</p>
                <button type="button" data-testid="match-begin" className={cn(PRIMARY_BUTTON, "mt-4")} onClick={m.begin}>{t("web.rank.match.begin")}</button>
              </div>
            </>
          )}
        </BottomSheetContent>
      </BottomSheet>
    </div>
  );
}
