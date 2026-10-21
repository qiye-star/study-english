"""The scheduling port (L3 Task 4): Leitner and FSRS engines behind one `decide`, rollout buckets, box derivation.

Flag off (Leitner) must reproduce the recorded golden outputs exactly (`fixtures/leitner_golden.json`).
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import scheduling as sch
from app.services.scheduling import (
    LEGACY_DIFFICULTY, LEITNER, SchedulingPolicy, SrsSnapshot, bucket, decide, derive_box, policy_for, seed_stability,
    seeded,
)
from tests.test_srs_golden import NOWS

GOLDEN = Path(__file__).parent / "fixtures" / "leitner_golden.json"
T = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)


def _snap(box, *, fsrs=None, last_reviewed_at=None, created_at=None) -> SrsSnapshot:
    created = created_at or T - timedelta(days=30)
    if fsrs is None:
        return SrsSnapshot(box=box, stability=None, difficulty=None, fsrs_state=None, last_review=None,
                           last_reviewed_at=last_reviewed_at, created_at=created)
    s, d, last = fsrs
    return SrsSnapshot(box=box, stability=s, difficulty=d, fsrs_state=2, last_review=last,
                       last_reviewed_at=last_reviewed_at, created_at=created)


def test_the_leitner_rules_moved_here_unchanged():
    from app.services.vocabulary import INTERVAL_DAYS as V_INTERVALS, MAX_BOX as V_MAX, next_review as V_NEXT
    assert sch.INTERVAL_DAYS == V_INTERVALS == (1, 2, 4, 7, 15, 30)
    assert sch.MAX_BOX == V_MAX == 5
    assert V_NEXT is sch.next_review


# ---- box <-> stability ----

@pytest.mark.parametrize("box", range(6))
def test_derive_box_inverts_seed_stability(box):
    assert derive_box(seed_stability(box)) == box


def test_seed_stability_clamps_the_box():
    assert seed_stability(-1) == 1.0
    assert seed_stability(9) == 30.0


def test_derive_box_is_monotone_and_has_the_expected_floors():
    values = [0.0, 0.3, 0.99, 1.0, 2.0, 3.99, 4.0, 7.0, 14.9, 15.0, 29.9, 30.0, 1000.0]
    boxes = [derive_box(v) for v in values]
    assert boxes == sorted(boxes)
    assert derive_box(0.3) == 0
    assert derive_box(15) == 4  # == MASTERED_BOX in app.wordbook.plan (asserted in the wordbook tests)
    assert derive_box(1000) == 5


# ---- seeding (plan R6) ----

def test_seeded_fills_null_columns_from_the_box_and_the_legacy_difficulty():
    last = T - timedelta(days=3)
    st = seeded(_snap(3, last_reviewed_at=last))
    assert (st.state, st.stability, st.difficulty, st.last_review) == (2, 7.0, LEGACY_DIFFICULTY, last)


def test_seeded_falls_back_to_created_at_when_never_reviewed():
    created = T - timedelta(days=30)
    st = seeded(_snap(0, created_at=created))
    assert st.last_review == created and st.stability == 1.0


def test_seeded_keeps_existing_fsrs_columns_as_they_are():
    last = T - timedelta(days=2)
    st = seeded(_snap(1, fsrs=(12.5, 3.25, last)))
    assert (st.stability, st.difficulty, st.state, st.last_review) == (12.5, 3.25, 2, last)


def test_seeded_normalises_sqlite_naive_datetimes_to_utc():
    naive = datetime(2026, 10, 2, 12, 0)  # what SQLite returns
    st = seeded(_snap(3, last_reviewed_at=naive))
    assert st.last_review == datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)


# ---- rollout buckets and policy (plan R10) ----

def test_bucket_is_pinned_for_fixed_users():
    expected = {1: 7, 2: 22, 3: 53, 42: 24, 1000: 60, 123456: 37}
    assert {u: bucket(u) for u in expected} == expected


def test_bucket_is_always_in_range():
    assert all(0 <= bucket(u) < 100 for u in range(1, 2001))


def _settings(pct: int, retention: int = 90):
    return SimpleNamespace(wordbook_fsrs_pct=pct, wordbook_fsrs_retention_pct=retention)


def test_pct_zero_is_all_leitner_and_pct_hundred_is_all_fsrs():
    assert all(policy_for(_settings(0), u).engine == "leitner" for u in range(1, 2001))
    assert all(policy_for(_settings(100), u).engine == "fsrs" for u in range(1, 2001))


def test_raising_pct_never_moves_a_user_back_to_leitner():
    at_10 = {u for u in range(1, 2001) if policy_for(_settings(10), u).engine == "fsrs"}
    at_50 = {u for u in range(1, 2001) if policy_for(_settings(50), u).engine == "fsrs"}
    assert at_10 <= at_50 and len(at_50) > len(at_10)


def test_policy_retention_is_the_setting_over_one_hundred():
    assert policy_for(_settings(0, 85), 1).retention == 0.85
    assert policy_for(_settings(100, 95), 1).retention == 0.95


# ---- flag off == Leitner golden ----

def _golden_pure_rows():
    return json.loads(GOLDEN.read_text(encoding="utf-8"))["pure"]


@pytest.mark.parametrize("row", _golden_pure_rows(), ids=lambda r: f"{r['now']}-{r['box']}-{r['grade']}")
def test_leitner_decision_matches_the_golden_row(row):
    d = decide(LEITNER, _snap(row["box"], last_reviewed_at=None), row["grade"], NOWS[row["now"]])
    assert (d.box, d.due_at.isoformat(), d.lapsed) == (row["box_out"], row["due_at"], row["lapsed"])


def test_easy_under_leitner_is_good():
    for box in range(-1, 7):
        for now in NOWS.values():
            a = decide(LEITNER, _snap(box), "easy", now)
            b = decide(LEITNER, _snap(box), "good", now)
            assert (a.box, a.due_at, a.lapsed) == (b.box, b.due_at, b.lapsed)


# ---- engines and the shadow state (plan R2) ----

def test_fsrs_engine_takes_box_and_due_from_the_shadow_state():
    policy = SchedulingPolicy("fsrs", 0.9)
    s = _snap(2, fsrs=(4.0, 5.0, T - timedelta(days=4)))
    d = decide(policy, s, "good", T)
    assert d.box == derive_box(d.fsrs.stability)
    assert d.due_at - T >= timedelta(days=1)
    assert d.lapsed is False


def test_forgot_is_a_lapse_in_both_engines():
    s = _snap(3, fsrs=(20.0, 5.0, T - timedelta(days=20)))
    assert decide(LEITNER, s, "forgot", T).lapsed is True
    assert decide(SchedulingPolicy("fsrs", 0.9), s, "forgot", T).lapsed is True


def test_the_shadow_state_does_not_depend_on_the_engine():
    s = _snap(3, last_reviewed_at=T - timedelta(days=15))
    for grade in ("forgot", "hard", "good", "easy"):
        a = decide(SchedulingPolicy("leitner", 0.9), s, grade, T).fsrs
        b = decide(SchedulingPolicy("fsrs", 0.9), s, grade, T).fsrs
        assert a == b


def test_unknown_grade_is_rejected():
    with pytest.raises(ValueError):
        decide(LEITNER, _snap(1), "meh", T)
