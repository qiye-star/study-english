import type { ApiClient } from "~/api/client";

export type TierKey = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "star" | "master";
export interface TierInfo { key: TierKey; index: number; cefr: string; divisions: number; divisionRp: number }
export interface SeasonInfo { id: number; startsOn: string; endsOn: string }
export interface RankConfig { enabled: boolean; matchAvailable: boolean; tiers: TierInfo[]; season: SeasonInfo | null }

export function fetchRankConfig(api: ApiClient, signal?: AbortSignal): Promise<RankConfig> {
  return api.request<RankConfig>("GET", "/api/rank/config", { signal });
}
