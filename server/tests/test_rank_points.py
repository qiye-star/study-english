from datetime import date, datetime, timedelta, timezone

from app.rank.points import (
    STAGE_TASKS, Candidate, EventRow, assessment_points, cap_daily, stage_progress, streak_ends,
)

T0 = datetime(2026, 10, 9, 8, 0, tzinfo=timezone.utc)


def c(kind, ref, points, day="2026-10-09", minutes=0, score=None):
    return Candidate(kind, ref, day, points, score, T0 + timedelta(minutes=minutes))


def test_assessment_points_by_score():
    assert [assessment_points(s) for s in (None, 40, 69.9, 70, 84, 85, 100)] == [1, 1, 1, 3, 3, 4, 4]


def test_cap_trims_in_time_order_and_keeps_zero_point_events():
    items = [c("assessment", f"a{i}", 4, minutes=i) for i in range(20)] + [c("active_day", "2026-10-09", 5, minutes=99)]
    out = cap_daily(items, {}, 60)
    capped = [e for e in out if e.kind == "assessment"]
    assert sum(e.points for e in capped) == 60 and len(capped) == 20
    assert [e.points for e in capped][14:16] == [4, 0]
    assert next(e for e in out if e.kind == "active_day").points == 5


def test_cap_counts_points_already_used_today_and_is_per_day():
    out = cap_daily([c("chat_turn", "m1", 1), c("chat_turn", "m2", 1, day="2026-10-10")], {"2026-10-09": 60}, 60)
    assert [e.points for e in out] == [0, 1]


def test_streak_ends_every_seventh_day_of_a_run():
    start = date(2026, 10, 1)
    run = {start + timedelta(days=i) for i in range(15)}
    assert streak_ends(run) == [date(2026, 10, 7), date(2026, 10, 14)]
    assert streak_ends(run - {date(2026, 10, 4)}) == [date(2026, 10, 11)]  # broken run: 3 + 11 days
    assert streak_ends({start + timedelta(days=i) for i in range(4, 11)}) == [date(2026, 10, 11)]


def test_stage_tasks_table_and_progress():
    assert [t.key for t in STAGE_TASKS[0]] == ["assess", "chat_turns", "vocab_reviews"]
    assert STAGE_TASKS[2][0].min_score == 75 and STAGE_TASKS[6] == ()
    rows = ([EventRow("assessment", 80, "2026-10-09")] * 18 + [EventRow("assessment", 60, "2026-10-09")] * 5
            + [EventRow("voice_turn", 90, "2026-10-09")] * 20 + [EventRow("vocab_review", None, "2026-10-09")] * 30)
    progress = {p.key: p for p in stage_progress(2, rows)}
    assert (progress["assess"].done, progress["assess"].complete) == (18, False)
    assert progress["voice_turns"].complete and progress["vocab_reviews"].complete


def test_active_days_count_distinct_days():
    rows = [EventRow("active_day", None, f"2026-10-0{d}") for d in range(1, 6)] + [EventRow("active_day", None, "2026-10-05")]
    progress = {p.key: p for p in stage_progress(1, rows)}
    assert (progress["active_days"].done, progress["active_days"].complete) == (5, True)
