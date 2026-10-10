import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import {
  PRESETS, clamp, daysToFinish, estimate, matchPreset, parseCount, previewPlan, reviewLoadOn, reviewOffsets, steadyReviews,
  type PlanInput,
} from "./goals-math";

type PlanCase = { name: string; in: Record<string, unknown>; out: Record<string, unknown> };

/**
 * 计划 GP-3:previewPlan 与服务端 compute_plan 共用 server/tests/fixtures/wordbook_plan_cases.json(GS1 写)。
 * Ruling GW1-a:服务端车道并行开发,样例表还没进本分支时用计划 GS1 Step 1 的同一份表(下方 PLAN_CASES,逐字照抄);
 * 样例文件一旦存在,下面的交叉核对自动生效,并要求两份表完全相同(任何一边改规则都必须改表)。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_CASES = path.resolve(here, "../../../../server/tests/fixtures/wordbook_plan_cases.json");
const serverCases: PlanCase[] | null = existsSync(SERVER_CASES) ? JSON.parse(readFileSync(SERVER_CASES, "utf8")) : null;

const plan = (o: Record<string, unknown>) => ({ review_done: 0, review_due: 0, review_left: 0, backlog_guard: false, bonus: 0, goal_met: false, ...o });
const PLAN_CASES: PlanCase[] = [
  { name: "basic", in: { daily_new: 20, review_cap: 100, new_done: 3, review_done: 10, review_due: 40 },
    out: plan({ new_target: 20, new_done: 3, new_left: 17, review_due: 40, review_done: 10, review_left: 40 }) },
  { name: "backlog_first_five", in: { daily_new: 20, review_cap: 100, new_done: 0, review_done: 95, review_due: 140 },
    out: plan({ new_target: 20, new_done: 0, new_left: 5, review_due: 140, review_done: 95, review_left: 5, backlog_guard: true }) },
  { name: "backlog_total_is_five", in: { daily_new: 20, review_cap: 100, new_done: 5, review_done: 100, review_due: 140 },
    out: plan({ new_target: 20, new_done: 5, new_left: 0, review_due: 140, review_done: 100, review_left: 0, backlog_guard: true, goal_met: true }) },
  { name: "raised_mid_day", in: { daily_new: 35, review_cap: 100, new_done: 20, review_done: 0, review_due: 0 },
    out: plan({ new_target: 35, new_done: 20, new_left: 15 }) },
  { name: "lowered_below_done", in: { daily_new: 10, review_cap: 100, new_done: 20, review_done: 0, review_due: 0 },
    out: plan({ new_target: 10, new_done: 20, new_left: 0, goal_met: true }) },
  { name: "bonus_after_goal", in: { daily_new: 20, review_cap: 100, new_done: 20, review_done: 30, review_due: 0, bonus: 10 },
    out: plan({ new_target: 30, new_done: 20, new_left: 10, review_done: 30, bonus: 10, goal_met: true }) },
  { name: "unlimited_backlog", in: { daily_new: 20, review_cap: null, new_done: 0, review_done: 0, review_due: 1500, guard_threshold: 1000 },
    out: plan({ new_target: 20, new_done: 0, new_left: 5, review_due: 1500, review_left: 1500, backlog_guard: true }) },
  { name: "unlimited_ok", in: { daily_new: 20, review_cap: null, new_done: 0, review_done: 0, review_due: 300, guard_threshold: 1000 },
    out: plan({ new_target: 20, new_done: 0, new_left: 20, review_due: 300, review_left: 300 }) },
  { name: "few_words_left", in: { daily_new: 20, review_cap: 100, new_done: 0, review_done: 0, review_due: 0, remaining: 7 },
    out: plan({ new_target: 20, new_done: 0, new_left: 7 }) },
  { name: "book_finished", in: { daily_new: 20, review_cap: 100, new_done: 3, review_done: 0, review_due: 0, remaining: 0 },
    out: plan({ new_target: 20, new_done: 3, new_left: 0, goal_met: true }) },
  { name: "cap_lowered_below_done", in: { daily_new: 20, review_cap: 50, new_done: 0, review_done: 80, review_due: 30 },
    out: plan({ new_target: 20, new_done: 0, new_left: 20, review_due: 30, review_done: 80, review_left: 0 }) },
  { name: "no_activity", in: { daily_new: 20, review_cap: 100, new_done: 0, review_done: 0, review_due: 0 },
    out: plan({ new_target: 20, new_done: 0, new_left: 20 }) },
];

const runCases = (cases: PlanCase[]) => {
  for (const c of cases) {
    expect(previewPlan(camelcaseKeys(c.in) as unknown as PlanInput), c.name).toEqual(camelcaseKeys(c.out));
  }
};

describe("goals-math (spec 2026-10-11 §4)", () => {
  it("lists the all-correct review days of the 6-box schedule", () => {
    expect(reviewOffsets(130)).toEqual([1, 3, 7, 14, 29, 59, 89, 119]);
    expect(reviewOffsets(0)).toEqual([]);
  });

  it("matches the spec table for CET-4 (4,544 words)", () => {
    expect([10, 20, 50].map((n) => daysToFinish(4544, n))).toEqual([455, 228, 91]);
    expect([10, 20, 50].map(steadyReviews)).toEqual([50, 100, 250]);
    expect([10, 20, 50].map((n) => reviewLoadOn(daysToFinish(4544, n), n, 4544))).toEqual([184, 204, 344]);
  });

  it("builds the review load day by day", () => {
    expect(reviewLoadOn(0, 20, 4544)).toBe(0);
    expect(reviewLoadOn(2, 20, 4544)).toBe(20);
    expect(reviewLoadOn(3, 20, 4544)).toBe(40);
    expect(reviewLoadOn(29, 20, 4544)).toBe(100); // 稳定期:5 批同时在复习
    expect(daysToFinish(0, 20)).toBe(0);
    expect(estimate(20, 100, 0)).toEqual({ days: 0, steady: 100, atFinish: 0, overCap: false });
  });

  it("gives the mockup numbers for 3,684 remaining words", () => {
    expect(PRESETS.map((p) => [p.id, estimate(p.dailyNew, p.reviewCap, 3684).days, estimate(p.dailyNew, p.reviewCap, 3684).steady]))
      .toEqual([["easy", 369, 50], ["standard", 185, 100], ["sprint", 74, 250]]);
    expect(estimate(35, 100, 3684)).toEqual({ days: 106, steady: 175, atFinish: 219, overCap: true });
    expect(estimate(20, null, 3684).overCap).toBe(false);
  });

  it("matches presets only on exact values", () => {
    expect(matchPreset(10, 100)).toBe("easy");
    expect(matchPreset(20, 200)).toBe("standard");
    expect(matchPreset(50, null)).toBe("sprint");
    expect(matchPreset(20, 100)).toBeNull();
  });

  it("mirrors compute_plan on the plan's shared table (GS1 Step 1)", () => {
    expect(PLAN_CASES.length).toBeGreaterThanOrEqual(12);
    runCases(PLAN_CASES);
  });

  it.skipIf(serverCases === null)("mirrors the server's compute_plan on server/tests/fixtures/wordbook_plan_cases.json (pending GS1 merge)", () => {
    expect(serverCases).toEqual(PLAN_CASES);
    runCases(serverCases!);
  });

  it("parses counts from any keyboard and clamps", () => {
    expect(parseCount("35")).toBe(35);
    expect(parseCount("３５")).toBe(35);
    expect(parseCount(" 7 ")).toBe(7);
    expect(parseCount("")).toBeNull();
    expect(parseCount("3a")).toBeNull();
    expect(parseCount("12345")).toBeNull();
    expect(clamp(250, 1, 200)).toBe(200);
    expect(clamp(-3, 1, 200)).toBe(1);
  });
});
