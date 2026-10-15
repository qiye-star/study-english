import { useTranslation } from "react-i18next";
import { LQ_ICON_WELL } from "~/components/liquid";
import { cn } from "~/lib/cn";
import type { TierKey } from "./rank-api";
import { divisionLabel, TIER_ICONS } from "./tiers";

/** 设计稿 rank-rooms-v1 `.tier`:md 48 / lg 96 圆底,罗马数字小签压在底边。 */
const SIZES = {
  sm: { disc: "size-9", icon: "size-5", roman: "-bottom-1 min-w-[18px] px-1 text-[10px] leading-4" },
  md: { disc: "size-12", icon: "size-[26px]", roman: "-bottom-[5px] min-w-[22px] px-1.5 text-label leading-[18px]" },
  lg: { disc: "size-24", icon: "size-[50px]", roman: "-bottom-[9px] min-w-[30px] px-2 text-sub leading-5" },
} as const;

/** 段位徽章:中性圆底 + 段位图形 + 罗马数字小段(一色一义:不为段位引入新色相)。 */
export function TierBadge({ tier, division, size = "md" }: { tier: TierKey; division: number; size?: keyof typeof SIZES }) {
  const { t } = useTranslation();
  const Icon = TIER_ICONS[tier];
  const roman = divisionLabel(division);
  const s = SIZES[size];
  return (
    <span data-testid="tier-badge" data-tier={tier} role="img" aria-label={`${t(`web.rank.tiers.${tier}`)} ${roman}`.trim()}
      className={cn("relative inline-flex flex-none items-center justify-center rounded-full bg-surface-2 text-ink shadow-hair", LQ_ICON_WELL, s.disc)}>
      <Icon aria-hidden strokeWidth={1.75} className={s.icon} />
      {roman && (
        <span aria-hidden className={cn("absolute left-1/2 -translate-x-1/2 rounded-inline bg-surface text-center font-semibold tabular-nums tracking-[0.02em] text-ink shadow-hair", s.roman)}>
          {roman}
        </span>
      )}
    </span>
  );
}
