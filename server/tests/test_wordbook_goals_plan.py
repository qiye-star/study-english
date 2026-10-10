"""goals v2 纯函数(spec 2026-10-11 §3–§6)。样例表与网页 goals-math.test.ts 共用(计划 GP-3)。"""
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.wordbook.plan import (BACKLOG_NEW, REVIEW_UNLIMITED, GoalLimits, compute_plan, effective_goals, goals_error,
                               streak_of)

CASES = json.loads((Path(__file__).parent / "fixtures" / "wordbook_plan_cases.json").read_text(encoding="utf-8"))
LIMITS = GoalLimits(new_min=1, new_max=200, review_min=10, review_max=1000, unlimited=True, bonus_max=50)
NARROW = GoalLimits(new_min=5, new_max=50, review_min=20, review_max=300, unlimited=False, bonus_max=0)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_compute_plan_matches_the_shared_table(case):
    assert asdict(compute_plan(**case["in"])) == case["out"]


def test_v1_calls_keep_their_results():
    p = compute_plan(daily_new=20, review_cap=100, new_done=3, review_done=10, review_due=40)
    assert (p.new_left, p.review_left, p.backlog_guard, p.bonus) == (17, 40, False, 0)
    assert list(asdict(p))[-2:] == ["bonus", "goal_met"]


def test_effective_goals_clamps_without_touching_storage():
    assert effective_goals(100, 500, NARROW) == (50, 300)
    assert effective_goals(1, 10, NARROW) == (5, 20)
    assert effective_goals(20, REVIEW_UNLIMITED, NARROW) == (20, 300)  # 「不限」被管理员关掉:按上限
    assert effective_goals(20, REVIEW_UNLIMITED, LIMITS) == (20, None)
    assert effective_goals(20, 100, LIMITS) == (20, 100)


def test_goals_error_messages():
    assert goals_error(LIMITS, daily_new=1, review_cap=1000, unlimited=False) is None
    assert goals_error(LIMITS, daily_new=None, review_cap=None, unlimited=True) is None
    assert goals_error(NARROW, daily_new=60, review_cap=None, unlimited=False) == "Daily new words out of range"
    assert goals_error(NARROW, daily_new=None, review_cap=10, unlimited=False) == "Review cap out of range"
    assert goals_error(NARROW, daily_new=None, review_cap=None, unlimited=True) == "Unlimited reviews are off"
    assert goals_error(LIMITS, daily_new=None, review_cap=100, unlimited=True) == "Conflicting review cap"


@pytest.mark.parametrize("days,today,expected", [
    (["2026-10-09", "2026-10-10", "2026-10-11"], "2026-10-11", 3),
    (["2026-10-09", "2026-10-10"], "2026-10-11", 2),  # 今天还没达标:从昨天往回数
    (["2026-10-08", "2026-10-10", "2026-10-11"], "2026-10-11", 2),
    (["2026-10-08"], "2026-10-11", 0),
    ([], "2026-10-11", 0),
    (["2026-09-30", "2026-10-01", "2026-10-01"], "2026-10-01", 2),  # 跨月;重复的日子只算一次
])
def test_streak_of(days, today, expected):
    assert streak_of(days, today) == expected


def test_constants():
    assert BACKLOG_NEW == 5 and REVIEW_UNLIMITED == 0
