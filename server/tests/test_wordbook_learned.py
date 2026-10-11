"""已学词与自由复习的纯规则(计划 2026-10-12-wordbook-learned-review S1)。"""
from datetime import datetime, timezone

import pytest

from app.wordbook import learned
from app.wordbook.plan import MASTERED_BOX

UTC = timezone.utc
NOW = datetime(2026, 10, 12, 3, 0, tzinfo=UTC)  # 本地(UTC+8)10 月 12 日 11:00


@pytest.mark.parametrize("box,tier", [(-1, "learning"), (0, "learning"), (1, "learning"), (2, "growing"), (3, "growing"),
                                      (4, "mastered"), (5, "mastered"), (9, "mastered")])
def test_tier_of(box, tier):
    assert learned.tier_of(box) == tier


def test_tiers_cover_every_stored_box_exactly_once():
    boxes = sorted(b for lo, hi in learned.TIERS.values() for b in range(lo, hi + 1))
    assert boxes == [0, 1, 2, 3, 4, 5]


def test_mastered_starts_at_the_home_page_mastered_box():
    assert learned.TIERS["mastered"][0] == MASTERED_BOX


def test_weak_needs_a_lapse_and_a_low_box():
    assert learned.is_weak(1, 1) and learned.is_weak(3, 4)
    assert not learned.is_weak(4, 3) and not learned.is_weak(0, 0) and not learned.is_weak(2, 0)


def test_cursor_round_trip():
    at = datetime(2026, 10, 12, 3, 4, 5, 123456, tzinfo=UTC)
    assert learned.decode_cursor(learned.encode_cursor(at, "abc-123")) == (at, "abc-123")


@pytest.mark.parametrize("text", ["", "!!!", "bm9wZQ", "MjAyNi0xMC0xMlQwMzowMDowMHxhYmM"])  # 空、非法、没有分隔符、没有时区
def test_cursor_rejects_garbage(text):
    assert learned.decode_cursor(text) is None


def test_scope_windows_use_local_days():
    assert learned.scope_window("yesterday", NOW, 480) == (datetime(2026, 10, 10, 16, tzinfo=UTC),
                                                           datetime(2026, 10, 11, 16, tzinfo=UTC))
    assert learned.scope_window("last7", NOW, 480) == (datetime(2026, 10, 5, 16, tzinfo=UTC), None)  # 本地 10/6 00:00 起
    assert learned.scope_window("all", NOW, 480) == (None, None)


def test_date_bounds_include_the_until_day():
    assert learned.date_bounds("2026-10-01", "2026-10-03", 480) == (datetime(2026, 9, 30, 16, tzinfo=UTC),
                                                                    datetime(2026, 10, 3, 16, tzinfo=UTC))
    assert learned.date_bounds(None, None, 0) == (None, None)


@pytest.mark.parametrize("since,until", [("2026-13-01", None), (None, "nope")])
def test_date_bounds_reject_bad_days(since, until):
    with pytest.raises(ValueError):
        learned.date_bounds(since, until, 0)
