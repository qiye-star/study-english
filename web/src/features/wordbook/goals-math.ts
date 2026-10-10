// 每日目标的估算与计划预览(spec 2026-10-11 §4、§12.2)。纯函数;previewPlan 与服务端 plan.compute_plan
// 共用 server/tests/fixtures/wordbook_plan_cases.json(计划 GP-3):改规则必须两边一起改。

/** = server/app/services/vocabulary.py INTERVAL_DAYS(下标 = 盒子号)。 */
export const INTERVAL_DAYS = [1, 2, 4, 7, 15, 30] as const;
const TOP_BOX = INTERVAL_DAYS.length - 1;
/** 从盒 0 爬到顶盒要答对的复习次数(学后第 1、3、7、14、29 天)。 */
export const CLIMB_REVIEWS = TOP_BOX;
/** = server plan.BACKLOG_NEW:积压时当天新词总数上限。 */
export const BACKLOG_NEW = 5;

/** 全对模型下,一个词在学后第几天被复习(≤ horizon):1、3、7、14、29,之后每 30 天。 */
export function reviewOffsets(horizon: number): number[] {
  const out: number[] = [];
  let day = 0;
  let box = 0;
  for (;;) {
    day += INTERVAL_DAYS[box];
    if (day > horizon) return out;
    out.push(day);
    box = Math.min(box + 1, TOP_BOX);
  }
}

/** D = ⌈W / N⌉ */
export const daysToFinish = (remaining: number, dailyNew: number) =>
  remaining <= 0 || dailyNew <= 0 ? 0 : Math.ceil(remaining / dailyNew);

/** S = 5N:从第 29 天起每天有 5 批词同时在复习。 */
export const steadyReviews = (dailyNew: number) => dailyNew * CLIMB_REVIEWS;

/** R(t):从今天起每天学 N 个(最后一天学剩下的),第 day 天的复习量。 */
export function reviewLoadOn(day: number, dailyNew: number, remaining: number): number {
  const days = daysToFinish(remaining, dailyNew);
  if (days === 0 || day < 1) return 0;
  const lastDay = remaining - dailyNew * (days - 1);
  let total = 0;
  for (const offset of reviewOffsets(day)) {
    const learnedOn = day - offset;
    if (learnedOn < days) total += learnedOn === days - 1 ? lastDay : dailyNew;
  }
  return total;
}

export interface Estimate { days: number; steady: number; atFinish: number; overCap: boolean }

export function estimate(dailyNew: number, reviewCap: number | null, remaining: number): Estimate {
  const days = daysToFinish(remaining, dailyNew);
  const steady = steadyReviews(dailyNew);
  return { days, steady, atFinish: reviewLoadOn(days, dailyNew, remaining), overCap: reviewCap !== null && steady > reviewCap };
}

export type PresetId = "easy" | "standard" | "sprint";
export interface GoalPreset { id: PresetId; dailyNew: number; reviewCap: number | null }

/** spec §4.1;reviewCap null = 不限 */
export const PRESETS: readonly GoalPreset[] = [
  { id: "easy", dailyNew: 10, reviewCap: 100 },
  { id: "standard", dailyNew: 20, reviewCap: 200 },
  { id: "sprint", dailyNew: 50, reviewCap: null },
];

export const matchPreset = (dailyNew: number, reviewCap: number | null): PresetId | null =>
  PRESETS.find((p) => p.dailyNew === dailyNew && p.reviewCap === reviewCap)?.id ?? null;

export interface PlanInput {
  dailyNew: number;
  /** null = 不限 */
  reviewCap: number | null;
  newDone: number;
  reviewDone: number;
  reviewDue: number;
  bonus?: number;
  guardThreshold?: number | null;
  remaining?: number | null;
}

export interface PlanPreview {
  newTarget: number; newDone: number; newLeft: number; reviewDue: number; reviewDone: number; reviewLeft: number;
  backlogGuard: boolean; bonus: number; goalMet: boolean;
}

/** 镜像服务端 compute_plan(含 G-3 积压修正与 G-6 达标)。 */
export function previewPlan(i: PlanInput): PlanPreview {
  const bonus = i.bonus ?? 0;
  const remaining = i.remaining ?? null;
  const threshold = i.reviewCap ?? i.guardThreshold ?? null;
  const guard = threshold !== null && i.reviewDue > threshold;
  const target = i.dailyNew + bonus;
  let newLeft = Math.max(0, (guard ? Math.min(target, BACKLOG_NEW) : target) - i.newDone);
  if (remaining !== null) newLeft = Math.min(newLeft, Math.max(0, remaining));
  const reviewLeft = i.reviewCap === null ? i.reviewDue : Math.min(i.reviewDue, Math.max(0, i.reviewCap - i.reviewDone));
  let goalNew = guard ? Math.min(i.dailyNew, BACKLOG_NEW) : i.dailyNew;
  if (remaining !== null) goalNew = Math.min(goalNew, i.newDone + Math.max(0, remaining));
  const goalMet = i.newDone + i.reviewDone > 0 && i.newDone >= goalNew && reviewLeft === 0;
  return { newTarget: target, newDone: i.newDone, newLeft, reviewDue: i.reviewDue, reviewDone: i.reviewDone, reviewLeft,
    backlogGuard: guard, bonus, goalMet };
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** 只接受 1–4 位数字(含全角数字,中文输入法常见);其它返回 null。 */
export function parseCount(text: string): number | null {
  const ascii = text.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  return /^\d{1,4}$/.test(ascii) ? Number(ascii) : null;
}
