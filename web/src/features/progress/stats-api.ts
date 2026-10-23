import type { ApiClient } from "~/api/client";
import { tzOffsetMinutes } from "~/lib/tz-offset";

export const STATS_PERIODS = [7, 30, 90] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

export interface StatsDay {
  date: string;
  active: boolean;
  userMessages: number;
  assessments: number;
  speakingSeconds: number;
  avgPronunciation: number | null;
}

export interface Stats {
  days: number;
  tzOffsetMinutes: number;
  today: string;
  daily: StatsDay[];
  activeDays: number;
  streakDays: number;
  userMessages: number;
  assessments: number;
  speakingSeconds: number;
  avgPronunciation: number | null;
  grammarTop: Array<{ category: string; count: number }>;
  poorWords: Array<{ word: string; count: number }>;
  truncated: boolean;
}

// Moved to lib/ (chat home needs it without a chat -> progress edge); re-exported unchanged.
export { tzOffsetMinutes };

export function getStats(api: ApiClient, days: StatsPeriod, signal?: AbortSignal): Promise<Stats> {
  return api.request("GET", "/api/stats", { query: { days, tz_offset_minutes: tzOffsetMinutes() }, signal });
}
