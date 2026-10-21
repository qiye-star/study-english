"""The fsrs adapter (L3 Task 3). Pure: no DB, no clock, no randomness (fuzzing is off in the scheduler)."""
import random
from datetime import datetime, timedelta, timezone

import pytest
from fsrs import Rating

from app.services.srs_fsrs import MAX_INTERVAL_DAYS, RATING, FsrsState, retrievability, review

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


def _state(stability: float, difficulty: float = 5.0, last: datetime = T0) -> FsrsState:
    return FsrsState(stability=stability, difficulty=difficulty, state=2, last_review=last)


def test_rating_values_match_the_fsrs_enum():
    assert RATING == {"forgot": Rating.Again, "hard": Rating.Hard, "good": Rating.Good, "easy": Rating.Easy}


def test_unknown_grade_is_rejected():
    with pytest.raises(ValueError):
        review(_state(4.0), "meh", T0 + timedelta(days=4), retention=0.9)


def test_naive_now_is_rejected():
    with pytest.raises(ValueError):
        review(_state(4.0), "good", datetime(2026, 10, 5, 12, 0), retention=0.9)


def test_non_utc_offset_gives_the_same_result_as_utc():
    now_utc = T0 + timedelta(days=4)
    now_cst = now_utc.astimezone(timezone(timedelta(hours=8)))
    a_state, a_due = review(_state(4.0), "good", now_utc, retention=0.9)
    b_state, b_due = review(_state(4.0), "good", now_cst, retention=0.9)
    assert (a_state, a_due) == (b_state, b_due)
    assert a_due.tzinfo is timezone.utc and a_state.last_review.tzinfo is timezone.utc


def test_review_is_deterministic():
    now = T0 + timedelta(days=4)
    assert review(_state(4.0), "good", now, retention=0.9) == review(_state(4.0), "good", now, retention=0.9)


def test_a_non_review_state_is_rejected():
    with pytest.raises(ValueError):
        review(FsrsState(stability=4.0, difficulty=5.0, state=1, last_review=T0), "good", T0, retention=0.9)


@pytest.mark.parametrize("bad", [0.0, 1.0, -0.1, 1.5])
def test_retention_must_be_a_probability(bad):
    with pytest.raises(ValueError):
        review(_state(4.0), "good", T0 + timedelta(days=4), retention=bad)


def test_good_after_four_days_is_a_review_state_due_later():
    new, due = review(_state(4.0), "good", T0 + timedelta(days=4), retention=0.9)
    assert new.state == 2 and new.last_review == T0 + timedelta(days=4)
    assert due - (T0 + timedelta(days=4)) >= timedelta(days=1)


def test_property_good_grows_and_again_shrinks_stability_at_due():
    rng = random.Random(0)
    for _ in range(200):
        s = rng.uniform(1, 60)
        d = rng.uniform(1, 10)
        now = T0 + timedelta(days=max(1, round(s)))  # the due moment for a card with interval about S
        state = _state(s, d)
        good, due_g = review(state, "good", now, retention=0.9)
        again, due_a = review(state, "forgot", now, retention=0.9)
        assert good.stability > s
        assert again.stability < s
        for new_state, due in ((good, due_g), (again, due_a)):
            assert new_state.state == 2
            assert timedelta(days=1) <= due - now <= timedelta(days=MAX_INTERVAL_DAYS)


def test_eight_goods_at_each_due_moment_strictly_increase_stability():
    state = _state(2.0)
    due = T0
    previous = state.stability
    for _ in range(8):
        state, due = review(state, "good", due, retention=0.9)
        assert state.stability > previous
        previous = state.stability


def test_higher_retention_never_means_a_longer_interval():
    rng = random.Random(1)
    for _ in range(200):
        s = rng.uniform(1, 60)
        d = rng.uniform(1, 10)
        now = T0 + timedelta(days=max(1, round(s)))
        _, due95 = review(_state(s, d), "good", now, retention=0.95)
        _, due85 = review(_state(s, d), "good", now, retention=0.85)
        assert due95 - now <= due85 - now


def test_retrievability_is_one_at_last_review_and_falls_over_time():
    state = _state(10.0)
    assert retrievability(state, T0) == pytest.approx(1.0)
    values = [retrievability(state, T0 + timedelta(days=k)) for k in (0, 1, 5, 10, 30, 90)]
    assert values == sorted(values, reverse=True)
    assert retrievability(state, T0 + timedelta(days=10)) == pytest.approx(0.9, abs=1e-6)


def test_the_result_does_not_depend_on_the_order_of_calls():
    a = review(_state(3.0), "hard", T0 + timedelta(days=3), retention=0.9)
    review(_state(9.0), "good", T0 + timedelta(days=9), retention=0.9)
    b = review(_state(3.0), "hard", T0 + timedelta(days=3), retention=0.9)
    assert a == b
