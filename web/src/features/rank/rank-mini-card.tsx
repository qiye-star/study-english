import { ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import { SurfaceCard } from "~/components/surface-card";
import { cn } from "~/lib/cn";
import { fetchRankConfig, type RankMe } from "./rank-api";
import { loadRankMe } from "./rank-me";
import { divisionLabel, pointsToGate } from "./tiers";

/**
 * 练习首页的段位小卡:一个关键数字(段位)+ 一行说明,点进 /rank。功能关闭时不渲染;
 * 没有数据(尚未跟读上榜或请求失败)时显示「—」与引导。
 */
export function RankMiniCard({ className }: { className?: string }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [state, setState] = useState<{ me: RankMe | null } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchRankConfig(api, ctrl.signal)
      .then(async (c) => ({ me: c.enabled ? await loadRankMe(api, tRef.current).catch((): null => null) : undefined }))
      .then((s) => { if (!ctrl.signal.aborted && s.me !== undefined) setState({ me: s.me }); }, (): void => undefined);
    return () => ctrl.abort();
  }, [api]);
  if (!state) return null;
  const me = state.me;
  const name = me ? `${t(`web.rank.tiers.${me.tier}`)} ${divisionLabel(me.division)}`.trim() : "—";
  const gate = me ? pointsToGate(me) : 0;
  const line = !me ? t("web.rank.mini.empty")
    : me.promotion.state === "eligible" ? t("web.rank.card.eligible")
    : me.tier === "master" ? t("web.rank.stars", { count: me.stars })
    : gate > 0 ? t("web.rank.card.toGate", { count: gate }) : t("web.rank.card.atGate");
  return (
    <Link to="/rank" data-testid="rank-mini-card" aria-label={`${t("web.rank.card.open")}: ${name}`} className="block min-w-0 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <SurfaceCard className={cn("flex min-h-[104px] flex-col justify-between p-3.5 transition-colors duration-fast active:bg-surface-2", className)}>
        <span className="flex items-center justify-between text-meta text-ink-2">
          {t("web.rank.title")}
          <ChevronRightIcon aria-hidden className="size-4 text-ink-3" />
        </span>
        <span className="mt-2 block min-w-0">
          <b className="block truncate text-headline font-bold tracking-tightest text-ink">{name}</b>
          <span className="mt-0.5 block truncate text-meta text-ink-2">{line}</span>
        </span>
      </SurfaceCard>
    </Link>
  );
}
