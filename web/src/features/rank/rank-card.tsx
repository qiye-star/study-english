import { ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import { LQ_BAR_TRACK, LQ_PANEL } from "~/components/liquid";
import { cn } from "~/lib/cn";
import { fetchRankConfig, type RankMe } from "./rank-api";
import { loadRankMe } from "./rank-me";
import { TierBadge } from "./tier-badge";
import { divisionLabel, pointsToGate, progressRatio } from "./tiers";

/** 练习首页与「我的」顶部的段位卡(spec §10.1)。功能关闭或请求失败时不渲染。 */
export function RankCard({ className }: { className?: string }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [me, setMe] = useState<RankMe | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    const ctrl = new AbortController();
    fetchRankConfig(api, ctrl.signal)
      .then((c) => (c.enabled ? loadRankMe(api, tRef.current) : null))
      .then((value) => { if (!ctrl.signal.aborted) setMe(value); }, (): void => undefined);
    return () => ctrl.abort();
  }, [api]);
  if (!me) return null;
  const ratio = progressRatio(me);
  const gate = pointsToGate(me);
  const eligible = me.promotion.state === "eligible";
  const hint = eligible ? t("web.rank.card.eligible")
    : me.tier === "master" ? t("web.rank.stars", { count: me.stars })
    : gate > 0 ? t("web.rank.card.toGate", { count: gate }) : t("web.rank.card.atGate");
  const name = `${t(`web.rank.tiers.${me.tier}`)} ${divisionLabel(me.division)}`.trim();
  return (
    <Link to="/rank" data-testid="rank-card" aria-label={`${t("web.rank.card.open")}: ${name}`}
      className={cn("flex min-h-row items-center gap-3.5 rounded-card border-[0.5px] border-hair bg-surface p-3.5 pb-4 shadow-card transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:shadow-none liquid:px-4", LQ_PANEL, className)}>
      <TierBadge tier={me.tier} division={me.division} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <b className="text-body font-semibold tracking-heading">{name}</b>
          <span className="text-meta tabular-nums text-ink-2">{t("web.rank.card.progress", { rp: me.rp, size: me.divisionRp })}</span>
        </span>
        <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}
          className={cn("mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-2", LQ_BAR_TRACK)}>
          <span className="block h-full rounded-full bg-blue" style={{ width: `${ratio * 100}%` }} />
        </span>
        <span className={cn("mt-1.5 block text-meta", eligible ? "font-semibold text-blue" : "text-ink-2")}>{hint}</span>
      </span>
      <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
    </Link>
  );
}
