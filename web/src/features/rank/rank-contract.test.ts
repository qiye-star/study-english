import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import type {
  AchievementItem, Match, MatchScenario, PromotionStatus, RankConfig, RankMe, RpEvent, SeasonInfo, StageTask, TierInfo, TurnResult, Verdict,
} from "./rank-api";
import { RANK_SERVER_ERRORS } from "./rank-api";
import { CONTRACT } from "./test-contract";

/**
 * 跨车道契约(F1):`rank_contract.json` 由 server/tests/test_rank_api.py 与 test_web_contract.py 对真实应用逐形状核对;
 * 这里核对 web 的类型与它逐键一致(`Record<keyof T, true>` 在编译期绑定类型,运行期对样例)。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const rankPy = readFileSync(path.resolve(here, "../../../../server/app/routers/rank.py"), "utf8");
const keys = (r: Record<string, true>) => Object.keys(r).sort();
const wire = (v: unknown) => Object.keys(camelcaseKeys(v as Record<string, unknown>)).sort();

const CONFIG: Record<keyof RankConfig, true> = { enabled: true, matchAvailable: true, tiers: true, season: true };
const TIER: Record<keyof TierInfo, true> = { key: true, index: true, cefr: true, divisions: true, divisionRp: true };
const SEASON: Record<keyof SeasonInfo, true> = { id: true, startsOn: true, endsOn: true };
const ME: Record<keyof RankMe, true> = { tier: true, tierIndex: true, division: true, rp: true, divisionRp: true, stars: true, stageTasks: true,
  promotion: true, season: true, seasonRp: true, recentEvents: true, newAchievements: true, activeMatchId: true };
const TASK: Record<keyof StageTask, true> = { key: true, kind: true, done: true, target: true, minScore: true, complete: true };
const PROMOTION: Record<keyof PromotionStatus, true> = { state: true, reason: true, cooldownUntil: true, attemptsLeft: true, targetTier: true };
const EVENT: Record<keyof RpEvent, true> = { kind: true, points: true, day: true, createdAt: true };
const ACHIEVEMENT: Record<keyof AchievementItem, true> = { key: true, group: true, icon: true, unlockedAt: true };
const MATCH: Record<keyof Match, true> = { id: true, status: true, fromTier: true, toTier: true, scenario: true, turnLimit: true, turns: true,
  attemptNo: true, startedAt: true, expiresAt: true, finishedAt: true };
const SCENARIO: Record<keyof MatchScenario, true> = { key: true, titleZh: true, titleEn: true, briefZh: true, functions: true };
const TURN: Record<keyof TurnResult, true> = { turnIndex: true, transcript: true, aiLine: true, done: true };
const VERDICT: Record<keyof Verdict, true> = { passed: true, total: true, threshold: true, dimensions: true, speechAvailable: true,
  gatesFailed: true, functionsMet: true, strengthsZh: true, improveZh: true, drillEn: true, newTier: true, cooldownUntil: true };
const DIMENSIONS: Record<keyof Verdict["dimensions"], true> = { task: true, accuracy: true, range: true, interaction: true, speech: true };

describe("rank payloads (pinned against the real server) match the web types", () => {
  it("config and me", () => {
    expect(wire(CONTRACT.config)).toEqual(keys(CONFIG));
    expect(wire(CONTRACT.config.tiers[0])).toEqual(keys(TIER));
    expect(wire(CONTRACT.config.season)).toEqual(keys(SEASON));
    expect(wire(CONTRACT.me)).toEqual(keys(ME));
    expect(wire(CONTRACT.me.stage_tasks[0])).toEqual(keys(TASK));
    expect(wire(CONTRACT.me.promotion)).toEqual(keys(PROMOTION));
    expect(wire(CONTRACT.me.recent_events[0])).toEqual(keys(EVENT));
    expect(wire(CONTRACT.achievements.achievements[0])).toEqual(keys(ACHIEVEMENT));
  });

  it("match, turn and verdict", () => {
    for (const m of [CONTRACT.match, CONTRACT.finish_pass.match, CONTRACT.finish_fail.match]) {
      expect(wire(m)).toEqual(keys(MATCH));
      expect(wire(m.scenario)).toEqual(keys(SCENARIO));
    }
    expect(wire(CONTRACT.turn)).toEqual(keys(TURN));
    for (const v of [CONTRACT.finish_pass.verdict, CONTRACT.finish_fail.verdict]) {
      expect(wire(v)).toEqual(keys(VERDICT));
      expect(wire(v.dimensions)).toEqual(keys(DIMENSIONS));
    }
  });

  it("every MATCH_ERRORS message in routers/rank.py has a translation", () => {
    const block = /MATCH_ERRORS[^{]*\{([\s\S]*?)\n\}/.exec(rankPy)![1];
    const messages = [...new Set([...block.matchAll(/\(\d{3}, "([^"]+)"\)/g)].map((m) => m[1]))];
    expect(messages.length).toBeGreaterThan(10);
    expect(messages.filter((m) => !(m in RANK_SERVER_ERRORS))).toEqual([]);
  });
});
