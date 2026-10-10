import type { PointsRule, RankRules, StageKind } from "./api";

/** 数字输入的范围,与服务端 app/rank/rules.py 的模型与 validate_rules 一致(百分比字段以 % 计)。 */
export const RANGES = {
  division_rp: [20, 2000],
  points: [0, 100],
  daily_cap: [0, 1000],
  band_floor: [0, 100],
  band_points: [0, 100],
  stage_target: [1, 1000],
  stage_min_score: [0, 100],
  turns: [3, 12],
  threshold: [0, 100],
  weight_pct: [0, 100],
  borderline: [0, 10],
  gate_task_min: [0, 4],
  gate_english_pct: [0, 100],
  min_seconds: [0.5, 10],
  max_seconds: [5, 60],
  daily_attempts: [0, 20],
  cooldown_minutes: [0, 1440],
  match_minutes: [5, 60],
  fail_keep_pct: [50, 100],
  season_weeks: [1, 52],
} as const satisfies Record<string, readonly [number, number]>;

export type RangeKey = keyof typeof RANGES;

/** 固定点数的种类(与服务端 PointsRule 同序);背单词两项在旧规则里可能缺省,按服务端默认值显示与校验 */
export const POINT_KINDS = ["chat_turn", "vocab_review", "active_day", "streak_7", "stage_task", "word_learned", "spelling_set"] as const;
export type PointKind = (typeof POINT_KINDS)[number];
export const POINT_DEFAULTS: Partial<Record<PointKind, number>> = { word_learned: 1, spelling_set: 2 };
export const pointValue = (p: PointsRule, k: PointKind): number => p[k] ?? POINT_DEFAULTS[k] ?? 0;

/** 阶段练习的种类(与服务端 StageTaskRule.kind 同序);只有跟读有分数门槛 */
export const STAGE_KIND_LIST: StageKind[] = ["assess", "chat_turns", "voice_turns", "vocab_reviews", "active_days", "words_learned"];
export const hasMinScore = (kind: StageKind): boolean => kind === "assess";

export const WEIGHT_KEYS = ["task", "accuracy", "range", "interaction"] as const;
export const MATCH_TIERS = ["1", "2", "3", "4", "5", "6"] as const;
export const EXAMINER_FIELDS = ["cefr", "role", "setting", "functions"];
export const JUDGE_FIELDS = ["cefr", "title_en", "functions"];

export function inRange(key: RangeKey, value: number): boolean {
  const [lo, hi] = RANGES[key];
  return Number.isFinite(value) && value >= lo && value <= hi;
}

export const pct = (ratio: number) => Math.round(ratio * 100);

/** 五项权重(含发音)的整数百分比之和 */
export function weightsTotal(r: RankRules): number {
  return WEIGHT_KEYS.reduce((sum, k) => sum + pct(r.match.llm_weights[k] ?? 0), 0) + pct(r.match.speech_weight);
}

/** 本地可判定的越界字段(路径列表);保存前必须为空 */
export function outOfRange(r: RankRules): string[] {
  const bad: string[] = [];
  const check = (path: string, key: RangeKey, v: number) => {
    if (!inRange(key, v)) bad.push(path);
  };
  r.tiers.forEach((t, i) => check(`tiers.${i}.division_rp`, "division_rp", t.division_rp));
  for (const k of POINT_KINDS) check(`points.${k}`, "points", pointValue(r.points, k));
  check("points.daily_cap", "daily_cap", r.points.daily_cap);
  r.points.assessment_bands.forEach(([f, p], i) => {
    check(`points.assessment_bands.${i}.0`, "band_floor", f);
    check(`points.assessment_bands.${i}.1`, "band_points", p);
  });
  for (const [tier, tasks] of Object.entries(r.stage_tasks)) {
    tasks.forEach((t, i) => {
      check(`stage_tasks.${tier}.${i}.target`, "stage_target", t.target);
      if (t.min_score !== null) check(`stage_tasks.${tier}.${i}.min_score`, "stage_min_score", t.min_score);
    });
  }
  for (const t of MATCH_TIERS) {
    check(`match.turns.${t}`, "turns", r.match.turns[t]);
    check(`match.thresholds.${t}`, "threshold", r.match.thresholds[t]);
  }
  check("match.borderline", "borderline", r.match.borderline);
  check("match.gate_task_min", "gate_task_min", r.match.gate_task_min);
  check("match.gate_english_ratio", "gate_english_pct", pct(r.match.gate_english_ratio));
  check("match.min_seconds", "min_seconds", r.match.min_seconds);
  check("match.max_seconds", "max_seconds", r.match.max_seconds);
  check("match.daily_attempts", "daily_attempts", r.match.daily_attempts);
  check("match.cooldown_minutes", "cooldown_minutes", r.match.cooldown_minutes);
  check("match.match_minutes", "match_minutes", r.match.match_minutes);
  check("match.fail_keep", "fail_keep_pct", pct(r.match.fail_keep));
  check("season.weeks", "season_weeks", r.season.weeks);
  return bad;
}

type Json = unknown;

/** 两份规则文档的叶子差异路径(数组按下标比较,长度不同时多出的下标算改动) */
export function diffPaths(a: Json, b: Json, prefix = ""): string[] {
  if (a === b) return [];
  const isObj = (v: Json) => v !== null && typeof v === "object";
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [prefix || "."];
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  const keys = Array.from(new Set([...ka, ...kb]));
  return keys.flatMap((k) =>
    diffPaths((a as Record<string, Json>)[k], (b as Record<string, Json>)[k], prefix ? `${prefix}.${k}` : k),
  );
}

export function getPath(doc: Json, path: string): Json {
  return path.split(".").reduce<Json>((v, k) => (v !== null && typeof v === "object" ? (v as Record<string, Json>)[k] : undefined), doc);
}

/** 模板占位符名(`{{`/`}}` 是转义的花括号);`{}` 记为 "" */
export function templateFields(template: string): string[] {
  const names = new Set<string>();
  const re = /\{\{|\}\}|\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    if (m[1] !== undefined) names.add(m[1]);
  }
  return Array.from(names);
}

export function templateProblems(template: string, required: string[]): { missing: string[]; extra: string[]; learner: boolean } {
  const fields = templateFields(template);
  return {
    missing: required.filter((f) => !fields.includes(f)),
    extra: fields.filter((f) => !required.includes(f)),
    learner: template.includes("<learner>"),
  };
}

export const cloneRules = (r: RankRules): RankRules => JSON.parse(JSON.stringify(r)) as RankRules;
