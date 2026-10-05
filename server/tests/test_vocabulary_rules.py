from datetime import datetime, timedelta, timezone

import pytest

from app.vocabulary import INTERVAL_DAYS, MAX_BOX, next_review, normalize_word

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)


def test_intervals_match_the_spec():
    assert INTERVAL_DAYS == (1, 2, 4, 7, 15, 30)
    assert MAX_BOX == 5


@pytest.mark.parametrize("box,new_box,days", [(0, 1, 2), (1, 2, 4), (2, 3, 7), (3, 4, 15), (4, 5, 30), (5, 5, 30)])
def test_good_moves_up_one_box_capped_at_5(box, new_box, days):
    r = next_review(box, "good", NOW)
    assert (r.box, r.due_at, r.lapsed) == (new_box, NOW + timedelta(days=days), False)


@pytest.mark.parametrize("box", range(6))
def test_forgot_goes_back_to_box_0_due_tomorrow(box):
    r = next_review(box, "forgot", NOW)
    assert (r.box, r.due_at, r.lapsed) == (0, NOW + timedelta(days=1), True)


@pytest.mark.parametrize("box,hours", [(0, 12), (1, 24), (2, 48), (3, 84), (4, 180), (5, 360)])
def test_hard_keeps_the_box_and_halves_its_interval(box, hours):
    r = next_review(box, "hard", NOW)
    assert (r.box, r.due_at, r.lapsed) == (box, NOW + timedelta(hours=hours), False)


def test_out_of_range_boxes_are_clamped():
    assert next_review(-3, "good", NOW).box == 1
    assert next_review(9, "good", NOW).box == 5
    assert next_review(9, "hard", NOW).due_at == NOW + timedelta(days=15)


def test_unknown_grade_is_rejected():
    with pytest.raises(ValueError):
        next_review(0, "easy", NOW)


def test_normalize_word():
    assert normalize_word("  Look   UP\tto ") == "look up to"
    assert normalize_word("Café") == "café"
    assert normalize_word("   ") == ""


def test_normalize_word_unifies_unicode_forms():
    assert normalize_word("Cafe\u0301") == normalize_word("Caf\u00e9") == "caf\u00e9"


from app.vocabulary import MAX_WORD, validate_word  # noqa: E402


def test_validate_word_accepts_and_normalizes():
    assert validate_word("  Look   UP ") == "look up"
    assert validate_word("x" * MAX_WORD) == "x" * MAX_WORD


@pytest.mark.parametrize("bad", ["", "   ", "a\x00b", "a\x07", "x" * (MAX_WORD + 1)])
def test_validate_word_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        validate_word(bad)


def test_naive_now_is_rejected():
    with pytest.raises(ValueError):
        next_review(0, "good", datetime(2026, 10, 5, 12, 0))
