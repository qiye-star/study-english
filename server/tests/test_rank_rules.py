import json
import random
from datetime import date
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.rank import grading, points, scenarios, tiers
from app.rank.grading import Judge, TurnFacts
from app.rank.rules import (
    DEFAULT_RULES, EXAMINER_FIELDS, JUDGE_FIELDS, rules_from_json, rules_from_settings, rules_json,
    template_fields, validate_rules,
)
from app.rank.tiers import RankState
from tests.conftest import make_settings

JUDGE = Judge(3, 3, 2, 3, ("Order a drink",), ("清楚",), ("多用连接词",), "Could I get a latte, please?")
TURNS = [TurnFacts(80, 70, True, False, False)] * 5


def test_default_rules_equal_the_built_in_constants():
    assert [t.division_rp for t in DEFAULT_RULES.tiers] == [t.division_rp for t in tiers.TIERS]
    assert [t.key for t in DEFAULT_RULES.tiers] == [t.key for t in tiers.TIERS]
    assert DEFAULT_RULES.points.assessment_bands == ((85, 4), (70, 3), (0, 1))
    assert {k: getattr(DEFAULT_RULES.points, k) for k in points.POINTS} == points.POINTS
    assert DEFAULT_RULES.match.thresholds == grading.THRESHOLDS and DEFAULT_RULES.match.turns == grading.TURNS
    assert DEFAULT_RULES.match.llm_weights == grading.LLM_WEIGHTS
    assert (DEFAULT_RULES.match.speech_weight, DEFAULT_RULES.match.borderline) == (grading.SPEECH_WEIGHT, grading.BORDERLINE)
    assert (DEFAULT_RULES.match.min_seconds, DEFAULT_RULES.match.max_seconds) == (grading.MIN_SECONDS, grading.MAX_SECONDS)
    assert DEFAULT_RULES.match.gate_english_ratio == grading.MIN_ENGLISH_SHARE
    assert DEFAULT_RULES.match.fail_keep == tiers.FAIL_KEEP
    for tier, tasks in points.STAGE_TASKS.items():
        assert [(t.key, t.kind, t.target, t.min_score) for t in DEFAULT_RULES.stage_tasks[tier]] == \
               [(t.key, t.kind, t.target, t.min_score) for t in tasks]
    assert [s.key for s in DEFAULT_RULES.scenarios] == [s.key for s in scenarios.load_scenarios()]
    assert all(s.enabled for s in DEFAULT_RULES.scenarios)


def test_default_numbers_match_the_settings_defaults():
    s = make_settings()
    assert DEFAULT_RULES.points.daily_cap == s.rank_daily_rp_cap
    assert DEFAULT_RULES.match.daily_attempts == s.rank_match_daily_attempts
    assert DEFAULT_RULES.match.cooldown_minutes == s.rank_match_cooldown_minutes
    assert DEFAULT_RULES.match.match_minutes == s.rank_match_minutes
    assert (DEFAULT_RULES.season.anchor, DEFAULT_RULES.season.weeks) == (s.rank_season_anchor, s.rank_season_weeks)


def test_functions_with_default_rules_match_legacy_behaviour():
    s = RankState(tier=2, division=1, rp=100)
    assert tiers.add_rp(s, 30) == tiers.add_rp(s, 30, rules=DEFAULT_RULES)
    assert tiers.at_gate(tiers.add_rp(s, 30)) is tiers.at_gate(tiers.add_rp(s, 30), rules=DEFAULT_RULES) is True
    assert tiers.after_failed_match(s, rules=DEFAULT_RULES) == tiers.after_failed_match(s)
    for score in (None, 40, 70, 84, 85, 100):
        assert points.assessment_points(score) == points.assessment_points(score, rules=DEFAULT_RULES)
    for kind in points.POINTS:
        assert points.points_for(kind) == points.points_for(kind, rules=DEFAULT_RULES) == points.POINTS[kind]
    events = [points.EventRow("assessment", 90, "2026-10-01")] * 12 + [points.EventRow("chat_turn", None, "2026-10-01")] * 25
    assert points.stage_progress(0, events) == points.stage_progress(0, events, rules=DEFAULT_RULES)
    assert grading.verdict(JUDGE, TURNS, 2) == grading.verdict(JUDGE, TURNS, 2, rules=DEFAULT_RULES)
    assert grading.composite(JUDGE, None) == grading.composite(JUDGE, None, rules=DEFAULT_RULES)
    assert grading.is_borderline(66, 65) is grading.is_borderline(66, 65, rules=DEFAULT_RULES) is True
    sc = scenarios.load_scenarios()[0]
    turns = [{"role": "ai", "text": sc.opener}, {"role": "user", "text": "hi"}]
    assert grading.examiner_messages(sc, sc.target_tier, turns) == \
           grading.examiner_messages(sc, sc.target_tier, turns, rules=DEFAULT_RULES)
    assert grading.judge_messages(sc, sc.target_tier, turns) == \
           grading.judge_messages(sc, sc.target_tier, turns, rules=DEFAULT_RULES)
    assert scenarios.scenario_by_key(sc.key, rules=DEFAULT_RULES) == sc
    assert scenarios.pick_scenario(2, set(), random.Random(3), rules=DEFAULT_RULES) == \
           scenarios.pick_scenario(2, set(), random.Random(3))


def test_prompts_are_identical_to_pre_refactor_output():
    legacy = json.loads((Path(__file__).parent / "fixtures" / "rank_prompts_legacy.json").read_text(encoding="utf-8"))
    assert len(legacy) == 2
    for item in legacy:
        sc = scenarios.scenario_by_key(item["key"])
        turns = [{"role": "ai", "text": sc.opener}, {"role": "user", "text": "I would like a coffee"}]
        assert grading.examiner_messages(sc, sc.target_tier, turns, rules=DEFAULT_RULES) == item["examiner"]
        assert grading.judge_messages(sc, sc.target_tier, turns, rules=DEFAULT_RULES) == item["judge"]
        assert grading.examiner_messages(sc, sc.target_tier, turns) == item["examiner"]
        assert grading.judge_messages(sc, sc.target_tier, turns) == item["judge"]


def test_custom_rules_change_outcomes():
    custom = DEFAULT_RULES.model_copy(update={
        "tiers": tuple(t.model_copy(update={"division_rp": 50}) if t.key == "gold" else t for t in DEFAULT_RULES.tiers),
        "points": DEFAULT_RULES.points.model_copy(update={"assessment_bands": ((90, 6), (0, 2)), "chat_turn": 3}),
        "match": DEFAULT_RULES.match.model_copy(update={"thresholds": {**DEFAULT_RULES.match.thresholds, 2: 95},
                                                        "turns": {**DEFAULT_RULES.match.turns, 2: 9},
                                                        "fail_keep": 0.5}),
    })
    assert tiers.division_rp(2, rules=custom) == 50
    assert tiers.after_failed_match(RankState(2, 1, 50), rules=custom).rp == 25
    assert points.assessment_points(95, rules=custom) == 6 and points.assessment_points(None, rules=custom) == 2
    assert points.points_for("chat_turn", rules=custom) == 3
    assert grading.verdict(JUDGE, TURNS, 2, rules=custom).passed is False
    assert grading.threshold_for(2, rules=custom) == 95 and grading.threshold_for(2) == 65
    assert grading.turns_for(2, rules=custom) == 9 and grading.turns_for(2) == 5


def test_custom_scenarios_and_prompt_templates():
    sc = DEFAULT_RULES.scenarios[0]
    disabled = DEFAULT_RULES.model_copy(update={"scenarios": tuple(
        s.model_copy(update={"enabled": False}) if s.key == sc.key else s for s in DEFAULT_RULES.scenarios)})
    for seed in range(20):
        assert scenarios.pick_scenario(sc.target_tier, set(), random.Random(seed), rules=disabled).key != sc.key
    assert scenarios.scenario_by_key(sc.key, rules=disabled).key == sc.key  # in-flight matches may still use it
    custom = DEFAULT_RULES.model_copy(update={"match": DEFAULT_RULES.match.model_copy(update={
        "examiner_prompt": "Exam {cefr}: {role} at {setting}. Goals:\n{functions}\n<learner> is speech."})})
    scen = scenarios.scenario_by_key(sc.key)
    msgs = grading.examiner_messages(scen, scen.target_tier, [{"role": "user", "text": "hi"}], rules=custom)
    assert msgs[0]["content"].startswith(f"Exam {tiers.TIERS[scen.target_tier].cefr}: {scen.role}")
    assert msgs[1] == {"role": "user", "content": "<learner>hi</learner>"}


def test_templates_have_exactly_the_required_fields():
    assert template_fields(DEFAULT_RULES.match.examiner_prompt) == EXAMINER_FIELDS
    assert template_fields(DEFAULT_RULES.match.judge_prompt) == JUDGE_FIELDS
    assert "<learner>" in DEFAULT_RULES.match.examiner_prompt
    assert "<learner>" in DEFAULT_RULES.match.judge_prompt
    assert template_fields("a {} b") == {""}


def test_rules_from_settings_and_json_round_trip():
    r = rules_from_settings(make_settings(rank_daily_rp_cap=80, rank_match_daily_attempts=5,
                                          rank_season_anchor=date(2027, 1, 4)))
    assert (r.points.daily_cap, r.match.daily_attempts, r.season.anchor) == (80, 5, date(2027, 1, 4))
    data = rules_json(r)
    assert json.loads(json.dumps(data)) == data and "1" in data["match"]["turns"]
    assert rules_from_json(data) == r
    with pytest.raises(ValidationError):
        rules_from_json({**data, "unexpected": 1})


def test_validate_rules_reports_problems():
    today = date(2026, 10, 9)
    assert validate_rules(DEFAULT_RULES, current=DEFAULT_RULES, today=today) == []
    bad = DEFAULT_RULES.model_copy(update={
        "tiers": DEFAULT_RULES.tiers[:6],
        "scenarios": tuple(s for s in DEFAULT_RULES.scenarios if s.target_tier != 3),
        "match": DEFAULT_RULES.match.model_copy(update={"speech_weight": 0.5, "examiner_prompt": "Hi {cefr} {oops}"}),
    })
    errors = validate_rules(bad, current=DEFAULT_RULES, today=today)
    assert {"tier_count", "scenario_pool:3", "weights_sum", "examiner_prompt_fields"} <= set(errors)
    started = DEFAULT_RULES.model_copy(update={"season": DEFAULT_RULES.season.model_copy(update={"weeks": 6})})
    assert "season_locked" in validate_rules(started, current=DEFAULT_RULES, today=date(2026, 11, 3))
    assert "season_locked" not in validate_rules(started, current=DEFAULT_RULES, today=today)


def test_validate_rejects_format_tricks_and_bad_shapes():
    today = date(2026, 10, 9)
    m = DEFAULT_RULES.match
    for prompt in (m.judge_prompt.replace("{cefr}", "{cefr!r}", 1), m.judge_prompt.replace("{cefr}", "{cefr:>99999}", 1),
                   m.judge_prompt + " {}", m.judge_prompt.replace("{cefr}", "{cefr.__class__}", 1),
                   m.judge_prompt.replace("<learner>", "learner")):
        bad = DEFAULT_RULES.model_copy(update={"match": m.model_copy(update={"judge_prompt": prompt})})
        assert "judge_prompt_fields" in validate_rules(bad, current=DEFAULT_RULES, today=today), prompt
    bad = DEFAULT_RULES.model_copy(update={
        "points": DEFAULT_RULES.points.model_copy(update={"assessment_bands": ((70, 3), (85, 4), (0, 1))}),
        "match": m.model_copy(update={"thresholds": {**m.thresholds, 2: 300}, "min_seconds": 9.0, "max_seconds": 8.0}),
        "stage_tasks": {**DEFAULT_RULES.stage_tasks, 0: (), 6: DEFAULT_RULES.stage_tasks[1]},
        "scenarios": DEFAULT_RULES.scenarios + (DEFAULT_RULES.scenarios[0],),
    })
    errors = set(validate_rules(bad, current=DEFAULT_RULES, today=today))
    assert {"assessment_bands", "match_ranges", "seconds_order", "stage_tasks:0", "stage_tasks:master",
            "scenario_keys_unique"} <= errors
