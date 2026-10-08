from datetime import datetime, timedelta, timezone

import pytest

from app.services.vocabulary import INTERVAL_DAYS, MAX_BOX, MAX_WORD, next_review, normalize_word, validate_word

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


def test_validate_word_accepts_and_normalizes():
    assert validate_word("  Look   UP ") == "look up"
    assert validate_word("x" * MAX_WORD) == "x" * MAX_WORD


@pytest.mark.parametrize("bad", ["", "   ", "a\x00b", "a\x07", "x" * (MAX_WORD + 1)])
def test_validate_word_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        validate_word(bad)


@pytest.mark.parametrize("grade", ["forgot", "hard", "good"])
def test_naive_now_is_rejected(grade):
    with pytest.raises(ValueError):
        next_review(0, grade, datetime(2026, 10, 5, 12, 0))


def test_typographic_variants_are_equal():
    assert normalize_word("Don't") == normalize_word("don’t") == normalize_word("DON‘T") == normalize_word("donʼt") == "don't"
    assert normalize_word("well‑known") == normalize_word("well‐known") == normalize_word("well-known") == "well-known"
    assert normalize_word(" 你好  ") == "你好"


def test_format_characters_are_stripped():
    assert normalize_word("a​b") == normalize_word("a‍﻿b") == "ab"
    assert normalize_word("​‍﻿") == ""
    with pytest.raises(ValueError):
        validate_word("​‍")
    assert validate_word("Don’t") == "don't"


def test_non_utc_now_gives_utc_outcomes():
    tz8 = timezone(timedelta(hours=8))
    now = datetime(2026, 10, 5, 20, 0, tzinfo=tz8)  # == NOW
    r = next_review(1, "good", now)
    assert r.due_at.utcoffset() == timedelta(0)
    assert r.due_at == NOW + timedelta(days=4)
