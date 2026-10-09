import { TrophyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { FeatureGate, type GateState } from "~/components/feature-gate";
import { SectionGroup } from "~/components/section-group";
import { PageHeader } from "~/layout/page-header";
import { PromotionCard } from "./promotion-card";
import { fetchRankConfig, fetchRankMe, RANK_SERVER_ERRORS, startMatch, type RankConfig, type RankMe } from "./rank-api";
import { StageTasks } from "./stage-tasks";
import { TierBadge } from "./tier-badge";
import { divisionLabel, pointsToGate, progressRatio } from "./tiers";
import { ICON_LINK } from "./ui";

const DAY = 86_400_000;
const RECENT_KINDS = new Set(["assessment", "voice_turn", "chat_turn", "vocab_review", "active_day", "streak_7", "stage_task"]);

export function RankHomePage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<GateState>("loading");
  const [config, setConfig] = useState<RankConfig | null>(null);
  const [me, setMe] = useState<RankMe | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    fetchRankConfig(api, ctrl.signal)
      .then(async (value) => {
        setConfig(value);
        if (!value.enabled) return setState("disabled");
        const profile = await fetchRankMe(api, undefined, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setMe(profile);
        setState("ready");
        // 只提示一次;语言切换不重新拉取
        if (profile.newAchievements.length) toast.success(tRef.current("web.rank.newAchievements", { count: profile.newAchievements.length }));
      })
      .catch(() => { if (!ctrl.signal.aborted) setState("error"); });
    return () => ctrl.abort();
  }, [api, attempt]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const match = await startMatch(api);
      navigate(`/rank/match/${match.id}`);
    } catch (err) {
      setError(translateServerError(t, err, RANK_SERVER_ERRORS));
      setStarting(false);
    }
  }

  const cefr = me && config?.tiers.find((tier) => tier.key === me.tier)?.cefr;
  const gate = me ? pointsToGate(me) : 0;
  const ratio = me ? progressRatio(me) : 0;
  const tasksDone = me ? me.stageTasks.filter((task) => task.complete).length : 0;
  const daysLeft = me?.season ? Math.max(0, Math.ceil((Date.parse(me.season.endsOn) + DAY - Date.now()) / DAY)) : 0;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.rank.title")} back="/practice"
        actions={state === "ready" ? (
          <Link to="/rank/achievements" data-testid="rank-achievements-link" aria-label={t("web.rank.achievementsLink")} className={ICON_LINK}>
            <TrophyIcon aria-hidden />
          </Link>
        ) : undefined} />
      <FeatureGate state={state} disabledText={t("web.rank.disabled")} onRetry={() => setAttempt((n) => n + 1)}>
        {me && (
          <div className="px-gutter pb-8">
            <section data-testid="rank-hero" className="flex flex-col items-center pt-1.5 text-center">
              <TierBadge tier={me.tier} division={me.division} size="lg" />
              <h2 className="mt-[18px] text-headline font-semibold">{`${t(`web.rank.tiers.${me.tier}`)} ${divisionLabel(me.division)}`.trim()}</h2>
              {cefr && <p className="mt-0.5 text-meta text-ink-2">{t("web.rank.cefr", { level: cefr })}</p>}
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}
                className="mt-3 h-1.5 w-[200px] overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-blue" style={{ width: `${ratio * 100}%` }} />
              </div>
              <p className="mt-2 text-meta tabular-nums text-ink-2">
                {t("web.rank.card.progress", { rp: me.rp, size: me.divisionRp })}
                {me.tier === "master" ? ` · ${t("web.rank.stars", { count: me.stars })}`
                  : ` · ${gate > 0 ? t("web.rank.card.toGate", { count: gate }) : t("web.rank.card.atGate")}`}
              </p>
            </section>
            {me.stageTasks.length > 0 && (
              <SectionGroup title={t("web.rank.tasks.title")} bare
                action={<span className="font-medium tabular-nums">{`${tasksDone}/${me.stageTasks.length}`}</span>}>
                <StageTasks tasks={me.stageTasks} />
              </SectionGroup>
            )}
            <SectionGroup title={t("web.rank.promotion.title")} bare>
              <PromotionCard me={me} starting={starting} error={error} onStart={() => void start()}
                onResume={() => navigate(`/rank/match/${me.activeMatchId}`)} />
            </SectionGroup>
            <p data-testid="rank-season" className="mt-[18px] flex items-center justify-between gap-3 px-0.5 text-meta text-ink-2">
              <span>{me.season ? `${t("web.rank.season.title", { id: me.season.id })} · ${t("web.rank.season.left", { days: daysLeft })}` : t("web.rank.season.preseason")}</span>
              {me.season && <span className="tabular-nums">{t("web.rank.season.points", { points: me.seasonRp })}</span>}
            </p>
            {me.recentEvents.length > 0 && (
              <SectionGroup title={t("web.rank.recent.title")}>
                {me.recentEvents.slice(0, 5).map((e, i) => (
                  <div key={i} data-testid="rank-event" className="flex min-h-11 items-center justify-between gap-3 px-3.5 text-sub">
                    <span>{t(`web.rank.recent.${RECENT_KINDS.has(e.kind) ? e.kind : "other"}`)}</span>
                    <span className="font-semibold tabular-nums text-blue">+{e.points}</span>
                  </div>
                ))}
              </SectionGroup>
            )}
          </div>
        )}
      </FeatureGate>
    </div>
  );
}
