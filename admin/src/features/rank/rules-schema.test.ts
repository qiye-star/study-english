import { expect, it } from "vitest";
import { RANGES, cloneRules, diffPaths, inRange, outOfRange, templateFields, templateProblems, weightsTotal } from "./rules-schema";
import { defaultRules } from "./test-fixtures";

it("mirrors the server model bounds", () => {
  expect(RANGES.division_rp).toEqual([20, 2000]);
  expect(RANGES.turns).toEqual([3, 12]);
  expect(RANGES.fail_keep_pct).toEqual([50, 100]);
  expect(inRange("threshold", 100)).toBe(true);
  expect(inRange("threshold", 101)).toBe(false);
  expect(inRange("min_seconds", Number.NaN)).toBe(false);
});

it("sums the five weights in whole percent and flags out-of-range numbers", () => {
  const r = defaultRules();
  expect(weightsTotal(r)).toBe(100);
  expect(outOfRange(r)).toEqual([]);
  const bad = cloneRules(r);
  bad.match.speech_weight = 0.3;
  bad.match.thresholds["2"] = 300;
  bad.tiers[0].division_rp = 5;
  expect(weightsTotal(bad)).toBe(110);
  expect(outOfRange(bad)).toEqual(["tiers.0.division_rp", "match.thresholds.2"]);
});

it("lists changed leaf paths", () => {
  const a = defaultRules();
  const b = cloneRules(a);
  b.points.daily_cap = 90;
  b.match.turns["1"] = 3;
  b.scenarios[0].enabled = false;
  expect(diffPaths(a, b)).toEqual(["points.daily_cap", "match.turns.1", "scenarios.0.enabled"]);
  expect(diffPaths(a, cloneRules(a))).toEqual([]);
});

it("reads template placeholders like str.format", () => {
  expect(templateFields('Hi {cefr} {{"task":0}} {role}')).toEqual(["cefr", "role"]);
  expect(templateFields("x {} y")).toEqual([""]);
  expect(templateProblems("Level {cefr} {oops}", ["cefr", "role"])).toEqual({ missing: ["role"], extra: ["oops"], learner: false });
});
