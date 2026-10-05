import type { ApiClient } from "~/api/client";

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

/** 服务端接受的范围(UTC-12 .. UTC+14)。 */
const MIN_OFFSET = -720;
const MAX_OFFSET = 840;

/** R23:相对 UTC 往东的分钟数(UTC+8 → 480),夹在服务端范围内,避免 422。 */
export function tzOffsetMinutes(date: Date = new Date()): number {
  const east = -date.getTimezoneOffset();
  if (!Number.isFinite(east)) return 0;
  return Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, Math.round(east))) || 0; // `|| 0` 避免 -0
}

export function getStats(api: ApiClient, days: StatsPeriod, signal?: AbortSignal): Promise<Stats> {
  return api.request("GET", "/api/stats", { query: { days, tz_offset_minutes: tzOffsetMinutes() }, signal });
}
