import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import {
  BACKLOG_NEW, INTERVAL_DAYS, PRESETS, clamp, daysToFinish, estimate, matchPreset, parseCount, previewPlan, reviewLoadOn, reviewOffsets,
  steadyReviews, type PlanInput,
} from "./goals-math";

type PlanCase = { name: string; in: Record<string, unknown>; out: Record<string, unknown> };

/**
 * 计划 GP-3:previewPlan 与服务端 compute_plan 共用 server/tests/fixtures/wordbook_plan_cases.json(GS1 写,
 * 服务端 test_wordbook_goals_plan.py 读同一份)。goals 计划 Z1:GW1-a 的内嵌副本已删除,这里只读服务端的表;
 * 表不存在就是失败(不跳过)。估算公式依赖的常量也直接核对服务端源码,任何一边改都会让这里变红。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, "../../../../server");
const PLAN_CASES: PlanCase[] = JSON.parse(readFileSync(path.join(SERVER, "tests/fixtures/wordbook_plan_cases.json"), "utf8"));
const pyConst = (file: string, name: string) => {
  const m = readFileSync(path.join(SERVER, file), "utf8").match(new RegExp(`^${name} = (.+?)(?:\\s+#.*)?$`, "m"));
  if (!m) throw new Error(`${name} not found in ${file}`);
  return JSON.parse(m[1].replace(/^\(/, "[").replace(/\)$/, "]"));
};

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

  it("mirrors the server's compute_plan on every case of server/tests/fixtures/wordbook_plan_cases.json", () => {
    expect(PLAN_CASES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(PLAN_CASES.map((c) => c.name)).size).toBe(PLAN_CASES.length);
    runCases(PLAN_CASES);
  });

  it("uses the server's box intervals and backlog limit (estimates and preview share them)", () => {
    expect([...INTERVAL_DAYS]).toEqual(pyConst("app/services/vocabulary.py", "INTERVAL_DAYS"));
    expect(BACKLOG_NEW).toBe(pyConst("app/wordbook/plan.py", "BACKLOG_NEW"));
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
