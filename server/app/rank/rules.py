"""可由管理端发布的段位规则(管理后台 v2 spec §5.1)。

DEFAULT_RULES 与 tiers/points/grading/scenarios 的常量逐项相等(tests/test_rank_rules.py 钉住);那些模块不导入
本文件(避免循环),它们的仅关键字参数 `rules=None` 按鸭子类型读取下列字段,None = 内置常量。"""
import json
import string
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.rank import grading, points, scenarios, tiers

_FROZEN = ConfigDict(frozen=True, extra="forbid")

EXAMINER_TEMPLATE = grading.EXAMINER_TEMPLATE
JUDGE_TEMPLATE = grading.JUDGE_TEMPLATE
EXAMINER_FIELDS = frozenset({"cefr", "role", "setting", "functions"})
JUDGE_FIELDS = frozenset({"cefr", "title_en", "functions"})
MATCH_TIERS = frozenset(range(1, len(tiers.TIERS)))


class TierRule(BaseModel):
    model_config = _FROZEN
    key: str
    division_rp: int = Field(ge=20, le=2000)


class PointsRule(BaseModel):
    model_config = _FROZEN
    assessment_bands: tuple[tuple[int, int], ...]  # (score floor, points), descending, last floor 0
    chat_turn: int = Field(ge=0, le=100)
    vocab_review: int = Field(ge=0, le=100)
    active_day: int = Field(ge=0, le=100)
    streak_7: int = Field(ge=0, le=100)
    stage_task: int = Field(ge=0, le=100)
    daily_cap: int = Field(ge=0, le=1000)


class StageTaskRule(BaseModel):
    model_config = _FROZEN
    key: str = Field(min_length=1, max_length=32)
    kind: Literal["assess", "chat_turns", "voice_turns", "vocab_reviews", "active_days"]
    target: int = Field(ge=1, le=1000)
    min_score: int | None = Field(None, ge=0, le=100)


class MatchRule(BaseModel):
    model_config = _FROZEN
    turns: dict[int, int]  # target tier 1–6 -> 3–12 (validate_rules)
    thresholds: dict[int, int]  # target tier 1–6 -> 0–100 (validate_rules)
    llm_weights: dict[str, float]
    speech_weight: float = Field(ge=0, le=1)
    borderline: int = Field(ge=0, le=10)
    gate_task_min: int = Field(ge=0, le=4)
    gate_english_ratio: float = Field(ge=0, le=1)
    min_seconds: float = Field(ge=0.5, le=10)
    max_seconds: float = Field(ge=5, le=60)
    daily_attempts: int = Field(ge=0, le=20)
    cooldown_minutes: int = Field(ge=0, le=1440)
    match_minutes: int = Field(ge=5, le=60)
    fail_keep: float = Field(ge=0.5, le=1)
    examiner_prompt: str = Field(max_length=8000)
    judge_prompt: str = Field(max_length=8000)


class SeasonRule(BaseModel):
    model_config = _FROZEN
    anchor: date
    weeks: int = Field(ge=1, le=52)


class ScenarioRule(BaseModel):
    model_config = _FROZEN
    key: str = Field(min_length=1, max_length=64)
    target_tier: int = Field(ge=1, le=len(tiers.TIERS) - 1)
    title_zh: str = Field(max_length=100)
    title_en: str = Field(max_length=100)
    brief_zh: str = Field(max_length=300)
    role: str = Field(max_length=200)
    setting: str = Field(max_length=200)
    functions: tuple[str, ...]
    opener: str
    enabled: bool = True


class RankRules(BaseModel):
    model_config = _FROZEN
    tiers: tuple[TierRule, ...]
    points: PointsRule
    stage_tasks: dict[int, tuple[StageTaskRule, ...]]
    match: MatchRule
    season: SeasonRule
    scenarios: tuple[ScenarioRule, ...]


def template_fields(template: str) -> set[str]:
    """Replacement-field names; a positional `{}` shows up as ""."""
    return {name for _, name, _, _ in string.Formatter().parse(template) if name is not None}


def _template_ok(template: str, required: frozenset[str]) -> bool:
    try:
        parts = list(string.Formatter().parse(template))
    except ValueError:  # unbalanced braces
        return False
    for _, name, spec, conversion in parts:
        if name is not None and (spec or conversion):
            return False  # no `!r` / `:>99999`: the template only substitutes plain text
    return template_fields(template) == set(required) and "<learner>" in template


def _default() -> RankRules:
    s_defaults = {"daily_cap": 60, "daily_attempts": 3, "cooldown_minutes": 30, "match_minutes": 20,
                  "anchor": date(2026, 11, 2), "weeks": 8}  # = Settings defaults (pinned by a test)
    return RankRules(
        tiers=tuple(TierRule(key=t.key, division_rp=t.division_rp) for t in tiers.TIERS),
        points=PointsRule(assessment_bands=((85, 4), (70, 3), (0, 1)), daily_cap=s_defaults["daily_cap"], **points.POINTS),
        stage_tasks={tier: tuple(StageTaskRule(key=t.key, kind=t.kind, target=t.target, min_score=t.min_score)
                                 for t in tasks) for tier, tasks in points.STAGE_TASKS.items()},
        match=MatchRule(turns=dict(grading.TURNS), thresholds=dict(grading.THRESHOLDS),
                        llm_weights=dict(grading.LLM_WEIGHTS), speech_weight=grading.SPEECH_WEIGHT,
                        borderline=grading.BORDERLINE, gate_task_min=2, gate_english_ratio=grading.MIN_ENGLISH_SHARE,
                        min_seconds=grading.MIN_SECONDS, max_seconds=grading.MAX_SECONDS,
                        daily_attempts=s_defaults["daily_attempts"], cooldown_minutes=s_defaults["cooldown_minutes"],
                        match_minutes=s_defaults["match_minutes"], fail_keep=tiers.FAIL_KEEP,
                        examiner_prompt=EXAMINER_TEMPLATE, judge_prompt=JUDGE_TEMPLATE),
        season=SeasonRule(anchor=s_defaults["anchor"], weeks=s_defaults["weeks"]),
        scenarios=tuple(ScenarioRule(**{**s.__dict__, "functions": tuple(s.functions)}) for s in scenarios.load_scenarios()),
    )


DEFAULT_RULES = _default()


def rules_from_settings(s) -> RankRules:
    """v0 (nothing published yet): the constants plus the six env-backed rank_* numbers."""
    return DEFAULT_RULES.model_copy(update={
        "points": DEFAULT_RULES.points.model_copy(update={"daily_cap": s.rank_daily_rp_cap}),
        "match": DEFAULT_RULES.match.model_copy(update={
            "daily_attempts": s.rank_match_daily_attempts, "cooldown_minutes": s.rank_match_cooldown_minutes,
            "match_minutes": s.rank_match_minutes}),
        "season": SeasonRule(anchor=s.rank_season_anchor, weeks=s.rank_season_weeks),
    })


def rules_json(r: RankRules) -> dict:
    """JSON document: dict keys become strings ("1"), dates ISO strings."""
    return json.loads(r.model_dump_json())


def rules_from_json(data: dict) -> RankRules:
    """Raises pydantic.ValidationError (routes answer 422)."""
    return RankRules.model_validate(data)


def validate_rules(draft: RankRules, *, current: RankRules, today: date) -> list[str]:
    """Error codes that block publishing (spec §5.1); [] = publishable."""
    errors: list[str] = []
    n = len(tiers.TIERS)
    if [t.key for t in draft.tiers] != [t.key for t in tiers.TIERS]:
        errors.append("tier_count" if len(draft.tiers) != n else "tier_keys")
    for tier in range(1, n):
        pool = [s for s in draft.scenarios if s.target_tier == tier and s.enabled]
        if len(pool) < 2:
            errors.append(f"scenario_pool:{tier}")
    keys = [s.key for s in draft.scenarios]
    if len(keys) != len(set(keys)):
        errors.append("scenario_keys_unique")
    for s in draft.scenarios:
        if (not 3 <= len(s.functions) <= 4 or any(not f.strip() or len(f) > 120 for f in s.functions)
                or not s.opener.strip() or len(s.opener) > 300):
            errors.append(f"scenario_shape:{s.key}")
    if set(draft.stage_tasks) - set(range(n)):
        errors.append("stage_tasks:keys")
    for tier in range(0, n - 1):
        tasks = draft.stage_tasks.get(tier, ())
        if not 1 <= len(tasks) <= 4 or len({t.key for t in tasks}) != len(tasks):
            errors.append(f"stage_tasks:{tier}")
    if draft.stage_tasks.get(n - 1, ()):
        errors.append("stage_tasks:master")
    m = draft.match
    if (set(m.llm_weights) != set(grading.LLM_WEIGHTS) or any(w < 0 for w in m.llm_weights.values())
            or abs(sum(m.llm_weights.values()) + m.speech_weight - 1.0) > 0.001 or sum(m.llm_weights.values()) <= 0):
        errors.append("weights_sum")
    if set(m.thresholds) != MATCH_TIERS or set(m.turns) != MATCH_TIERS:
        errors.append("match_tiers")
    if any(not 0 <= v <= 100 for v in m.thresholds.values()) or any(not 3 <= v <= 12 for v in m.turns.values()):
        errors.append("match_ranges")
    if m.min_seconds >= m.max_seconds:
        errors.append("seconds_order")
    if not _template_ok(m.examiner_prompt, EXAMINER_FIELDS):
        errors.append("examiner_prompt_fields")
    if not _template_ok(m.judge_prompt, JUDGE_FIELDS):
        errors.append("judge_prompt_fields")
    bands = draft.points.assessment_bands
    floors = [b[0] for b in bands]
    if (not bands or floors[-1] != 0 or floors != sorted(floors, reverse=True) or len(set(floors)) != len(floors)
            or any(not 0 <= f <= 100 or not 0 <= p <= 100 for f, p in bands)):
        errors.append("assessment_bands")
    if draft.season != current.season and today >= current.season.anchor:
        errors.append("season_locked")
    return errors
