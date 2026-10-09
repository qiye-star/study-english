import { CrownIcon, DiamondIcon, HexagonIcon, ShieldCheckIcon, ShieldHalfIcon, ShieldIcon, StarIcon, type LucideIcon } from "lucide-react";
import type { Match, RankMe, TierKey } from "./rank-api";

export const TIER_KEYS: TierKey[] = ["bronze", "silver", "gold", "platinum", "diamond", "star", "master"];
/** 段位只靠图形区分,不引入新色相(spec §1、§4)。 */
export const TIER_ICONS: Record<TierKey, LucideIcon> = {
  bronze: ShieldIcon, silver: ShieldHalfIcon, gold: ShieldCheckIcon, platinum: HexagonIcon,
  diamond: DiamondIcon, star: StarIcon, master: CrownIcon,
};
const ROMAN = ["", "I", "II", "III"];

export const divisionLabel = (division: number) => ROMAN[division] ?? "";

export function progressRatio(me: Pick<RankMe, "rp" | "divisionRp">): number {
  return me.divisionRp > 0 ? Math.min(1, Math.max(0, me.rp / me.divisionRp)) : 0;
}

/** 距离段位门(I 小段满点)还差的点数;王者没有段位门。 */
export function pointsToGate(me: Pick<RankMe, "tier" | "division" | "rp" | "divisionRp">): number {
  if (me.tier === "master" || me.division < 1) return 0;
  return Math.max(0, (me.division - 1) * me.divisionRp + (me.divisionRp - me.rp));
}

export const userTurns = (match: Pick<Match, "turns">) => match.turns.filter((t) => t.role === "user").length;

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
