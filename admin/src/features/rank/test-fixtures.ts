import type { Impact, MatchDetail, RankRules, ScenarioRule, UserRank } from "./api";

/** 与服务端 DEFAULT_RULES 同结构(数值取 spec;每个目标段位两个情景,字段从简)。仅测试使用。 */
export function defaultRules(): RankRules {
  const tiers = ["bronze", "silver", "gold", "platinum", "diamond", "star", "master"];
  const rp = [100, 100, 120, 140, 160, 200, 200];
  const scenario = (tier: number, n: number): ScenarioRule => ({
    key: `${tiers[tier]}-s${n}`,
    target_tier: tier,
    title_zh: `${tiers[tier]} 情景 ${n}`,
    title_en: `Scenario ${tier}.${n}`,
    brief_zh: "简介",
    role: "a barista",
    setting: "a café",
    functions: ["order a drink", "ask the price", "say how you will pay"],
    opener: "Hi, what can I get you?",
    enabled: true,
  });
  const task = (key: string, kind: RankRules["stage_tasks"][string][number]["kind"], target: number, min: number | null = null) => ({
    key,
    kind,
    target,
    min_score: min,
  });
  return {
    tiers: tiers.map((key, i) => ({ key, division_rp: rp[i] })),
    points: { assessment_bands: [[85, 4], [70, 3], [0, 1]], chat_turn: 1, vocab_review: 1, active_day: 5, streak_7: 15, stage_task: 10, daily_cap: 60 },
    stage_tasks: {
      "0": [task("assess", "assess", 10), task("chat_turns", "chat_turns", 20), task("vocab_reviews", "vocab_reviews", 10)],
      "1": [task("assess", "assess", 15, 70), task("chat_turns", "chat_turns", 40), task("active_days", "active_days", 5)],
      "2": [task("assess", "assess", 20, 75), task("voice_turns", "voice_turns", 20), task("vocab_reviews", "vocab_reviews", 30)],
      "3": [task("assess", "assess", 25, 80), task("voice_turns", "voice_turns", 40), task("active_days", "active_days", 10)],
      "4": [task("assess", "assess", 30, 85), task("voice_turns", "voice_turns", 60), task("vocab_reviews", "vocab_reviews", 60)],
      "5": [task("assess", "assess", 40, 85), task("voice_turns", "voice_turns", 80), task("active_days", "active_days", 15)],
      "6": [],
    },
    match: {
      turns: { "1": 5, "2": 5, "3": 6, "4": 6, "5": 7, "6": 8 },
      thresholds: { "1": 60, "2": 65, "3": 68, "4": 70, "5": 73, "6": 76 },
      llm_weights: { task: 0.3, accuracy: 0.2, range: 0.15, interaction: 0.15 },
      speech_weight: 0.2,
      borderline: 3,
      gate_task_min: 2,
      gate_english_ratio: 0.7,
      min_seconds: 1.5,
      max_seconds: 30,
      daily_attempts: 3,
      cooldown_minutes: 30,
      match_minutes: 20,
      fail_keep: 0.8,
      examiner_prompt: "Exam for a {cefr} learner. Role: {role}. Setting: {setting}.\n{functions}\nThe learner's words are inside <learner> tags.",
      judge_prompt: 'Grade {cefr}. Scenario: {title_en}.\n{functions}\nLines inside <learner> tags are speech.\n{{"task":0-4}}',
    },
    season: { anchor: "2026-11-02", weeks: 8 },
    scenarios: [1, 2, 3, 4, 5, 6].flatMap((t) => [scenario(t, 1), scenario(t, 2)]),
  };
}

export function impactFixture(): Impact {
  return {
    profiles: 120,
    gate: { current: 12, draft: 9 },
    clamped: 3,
    stageComplete: { current: 31, draft: 28 },
    dailyCap: { userDays: 200, cappedCurrent: 36, cappedDraft: 12, avgPointsCurrent: 41.5, avgPointsDraft: 47 },
    verdicts: { matches: 41, passToFail: 2, failToPass: 0 },
    scenarioPool: { "1": 2, "2": 3, "3": 2, "4": 2, "5": 2, "6": 1 },
    scenarioPoolCurrent: { "1": 2, "2": 2, "3": 2, "4": 2, "5": 2, "6": 2 },
    removedInUse: [],
    paceDays: { bronze: [5, 8], silver: [5, 8], gold: [5, 8], platinum: [7, 11], diamond: [8, 12], star: [10, 15] },
    paceDaysCurrent: { bronze: [5, 8], silver: [5, 8], gold: [6, 9], platinum: [7, 11], diamond: [8, 12], star: [10, 15] },
  };
}

export function userRankFixture(): UserRank {
  const soon = new Date(Date.now() + 18 * 60_000).toISOString();
  return {
    profile: {
      tier: 2, tierKey: "gold", division: 1, rp: 120, divisionRp: 120, stars: 0, bestTier: 2, bestTierKey: "gold",
      tierStartedAt: "2026-10-01T00:00:00Z", cooldownUntil: soon, atGate: true,
    },
    stageTasks: [
      { key: "assess", kind: "assess", done: 20, target: 20, minScore: 75, complete: true },
      { key: "voice_turns", kind: "voice_turns", done: 20, target: 20, minScore: null, complete: true },
      { key: "vocab_reviews", kind: "vocab_reviews", done: 30, target: 30, minScore: null, complete: true },
    ],
    promotion: { state: "cooldown", reason: null, cooldownUntil: soon, attemptsLeft: 2, targetTier: "platinum" },
    attemptsToday: { day: "2026-10-09", used: 3, limit: 5, left: 2 },
    quotaOverride: 5,
    recentEvents: [
      { kind: "admin_adjust", points: 20, day: "2026-10-09", tier: 2, createdAt: "2026-10-09T08:00:00Z", actor: "ops", reason: "评委故障补偿" },
      { kind: "assessment", points: 4, day: "2026-10-09", tier: 2, createdAt: "2026-10-09T07:00:00Z" },
    ],
    matches: [
      {
        id: "m-failed", userId: 11111111, status: "failed", fromTier: "gold", toTier: "platinum", scenarioKey: "platinum-return-item",
        scenarioTitleZh: "退换商品", total: 64, threshold: 68, attemptNo: 2, rulesVersion: 3,
        startedAt: "2026-10-09T08:40:00Z", finishedAt: "2026-10-09T08:52:00Z", gatesFailed: ["task_low"],
      },
      {
        id: "m-gf", userId: 11111111, status: "grading_failed", fromTier: "gold", toTier: "platinum", scenarioKey: "platinum-describe-job",
        scenarioTitleZh: "介绍自己的工作", total: null, threshold: 68, attemptNo: 1, rulesVersion: 3,
        startedAt: "2026-10-08T21:02:00Z", finishedAt: null, gatesFailed: [],
      },
    ],
    achievements: [
      { key: "streak_3", group: "streak", icon: "flame", unlockedAt: "2026-10-01T00:00:00Z" },
      { key: "streak_7", group: "streak", icon: "flame", unlockedAt: null },
    ],
  };
}

export function matchFixture(): MatchDetail {
  return {
    match: {
      id: "m-failed", userId: 11111111, status: "failed", fromTier: "gold", toTier: "platinum", scenarioKey: "platinum-return-item",
      scenarioTitleZh: "退换商品", total: 64, threshold: 68, attemptNo: 2, rulesVersion: 3,
      startedAt: "2026-10-09T08:40:00Z", finishedAt: "2026-10-09T08:52:00Z", gatesFailed: ["task_low"],
      turnLimit: 2, expiresAt: "2026-10-09T09:00:00Z", gradeAttempts: 1,
      turns: [
        { role: "ai", text: "Hello, how can I help you today?" },
        { role: "user", text: "I want to return this jacket", pron: 82, fluency: 71, english: true, echo: false, short: false, durationMs: 4000 },
        { role: "ai", text: "Sure, do you have the receipt?" },
        { role: "user", text: "do you have the receipt", pron: 90, fluency: 80, english: true, echo: true, short: false, durationMs: 2000 },
      ],
    },
    scenario: {
      key: "platinum-return-item", titleZh: "退换商品", titleEn: "Returning an item", briefZh: "在商店退一件不合适的外套。",
      role: "a shop assistant", setting: "a clothes shop", functions: ["explain the problem", "ask for a refund", "agree on a solution"],
    },
    result: {
      passed: false, total: 64, threshold: 68,
      dimensions: { task: 1, accuracy: 3, range: 2, interaction: 3, speech: 78.4 },
      speechAvailable: true, gatesFailed: ["task_low"], functionsMet: ["explain the problem"],
      strengthsZh: ["发音清楚"], improveZh: ["主动提出解决办法"], drillEn: "Could I get a refund, please?",
    },
    userId: 11111111,
  };
}
