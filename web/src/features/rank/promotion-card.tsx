import { FlagIcon, PlayIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import type { RankMe } from "./rank-api";
import { formatCountdown } from "./tiers";
import { CARD, PRIMARY_BUTTON } from "./ui";

/** 晋级赛卡:6 种状态 + 进行中(spec §10.2)。只有 eligible 有主按钮;进行中显示「继续晋级赛」。 */
export function PromotionCard({ me, starting, error, onStart, onResume }: {
  me: RankMe; starting: boolean; error: string | null; onStart: () => void; onResume: () => void;
}) {
  const { t } = useTranslation();
  const { promotion } = me;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (promotion.state !== "cooldown") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [promotion.state]);
  const target = promotion.targetTier ? t("web.rank.promotion.target", { tier: t(`web.rank.tiers.${promotion.targetTier}`) }) : null;
  let note: string;
  if (me.activeMatchId) note = t("web.rank.promotion.active");
  else if (promotion.state === "locked") note = t(`web.rank.promotion.locked_${promotion.reason ?? "rp"}`);
  else if (promotion.state === "cooldown") note = t("web.rank.promotion.cooldown", { time: formatCountdown(Date.parse(promotion.cooldownUntil ?? "") - now) });
  else if (promotion.state === "eligible") note = t("web.rank.promotion.attemptsLeft", { count: promotion.attemptsLeft });
  else note = t(`web.rank.promotion.${promotion.state}`);
  return (
    <div data-testid="promotion-card" data-state={me.activeMatchId ? "active" : promotion.state} className={cn("p-3.5", CARD)}>
      {target && <b className="block text-body font-semibold tracking-[-0.01em]">{target}</b>}
      <p className={cn("text-meta text-ink-2", target && "mt-[3px]")}>{note}</p>
      {me.activeMatchId ? (
        <button type="button" data-testid="rank-resume" className={cn(PRIMARY_BUTTON, "mt-3")} onClick={onResume}>
          <PlayIcon aria-hidden />{t("web.rank.promotion.resume")}
        </button>
      ) : promotion.state === "eligible" ? (
        <button type="button" data-testid="rank-start" className={cn(PRIMARY_BUTTON, "mt-3")} disabled={starting} onClick={onStart}>
          <FlagIcon aria-hidden />{t("web.rank.promotion.start")}
        </button>
      ) : null}
      {error && <p role="alert" className="mt-2 text-meta text-ink-2">{error}</p>}
    </div>
  );
}
