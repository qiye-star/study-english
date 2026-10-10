// goals v2 的服务端响应样例(snake_case;spec 2026-10-11 §9)。只被 *.test.ts(x) 引用。
// 计划 GP-5:只在 v1 test-fixtures.ts 的样例上追加字段,不改 v1 样例(A/C 也在用)。
import type { GoalLimits } from "./wordbook-api";
import { CONFIG, ENROLLED_TODAY, ENROLLMENT, PLAN } from "./test-fixtures";

export const GOALS_CONFIG = {
  ...CONFIG,
  limits: { daily_new: { min: 1, max: 200 }, review_cap: { min: 10, max: 1000 }, review_unlimited: true, bonus_max: 50 },
};
export const GOALS_ENROLLMENT = { ...ENROLLMENT, review_unlimited: false };
export const GOALS_PLAN = { ...PLAN, bonus: 0, goal_met: false };
export const GOALS_TODAY = { ...ENROLLED_TODAY, enrollment: GOALS_ENROLLMENT, plan: GOALS_PLAN, paused: null as unknown, streak: { current: 12, today_met: false } };
export const GOAL_MET_TODAY = {
  ...GOALS_TODAY,
  plan: { ...GOALS_PLAN, new_done: 20, new_left: 0, review_due: 0, review_done: 34, review_left: 0, goal_met: true },
  streak: { current: 13, today_met: true },
};
export const PAUSED_TODAY: Record<string, unknown> = {
  enrollment: null, book: null, plan: null, progress: null, tomorrow_due: 0,
  paused: { ...GOALS_ENROLLMENT, status: "paused" }, streak: { current: 0, today_met: false },
};
/** camelCase 的范围(组件测试直接传 props) */
export const LIMITS: GoalLimits = { dailyNew: { min: 1, max: 200 }, reviewCap: { min: 10, max: 1000 }, reviewUnlimited: true, bonusMax: 50 };
