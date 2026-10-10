import { expect, it } from "vitest";
import {
  POINT_KINDS, RANGES, STAGE_KIND_LIST, cloneRules, diffPaths, hasMinScore, inRange, outOfRange, templateFields, templateProblems, weightsTotal,
} from "./rules-schema";
import { STAGE_KINDS, rulesError } from "./strings";
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

it("offers the wordbook stage kind without a score threshold and accepts rules without wordbook points", () => {
  expect(STAGE_KIND_LIST).toContain("words_learned");
  expect(STAGE_KINDS.words_learned).toBe("背单词新词");
  expect(hasMinScore("assess")).toBe(true);
  expect(hasMinScore("words_learned")).toBe(false);
  expect(hasMinScore("vocab_reviews")).toBe(false);
  expect(POINT_KINDS).toEqual(["chat_turn", "vocab_review", "active_day", "streak_7", "stage_task", "word_learned", "spelling_set"]);
  const old = cloneRules(defaultRules());
  delete old.points.word_learned;
  delete old.points.spelling_set;
  expect(outOfRange(old)).toEqual([]);
  const bad = cloneRules(defaultRules());
  bad.points.spelling_set = 101;
  expect(outOfRange(bad)).toEqual(["points.spelling_set"]);
  expect(rulesError("stage_tasks:wordbook_disabled")).toEqual({ tab: "stage", text: "背单词未开启,不能使用『背单词新词』阶段练习" });
});
