"""L4 Task 5: 三种状态与会话标识(纯函数;plan R8、R2)。阈值是占位,这里只钉边界。"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.activation.states import ACTIVE_SESSIONS, DORMANT_DAYS, GRACE_DAYS, session_key, state_of

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


@dataclass
class Usage:
    last_used_at: datetime
    use_count: int
    session_count: int
    shadow_count: int = 0


def days_ago(n: float) -> datetime:
    return NOW - timedelta(days=n)


def test_the_placeholder_thresholds_are_the_documented_values():
    assert (GRACE_DAYS, DORMANT_DAYS, ACTIVE_SESSIONS) == (3, 30, 2)


def test_a_word_learned_less_than_grace_days_ago_and_never_used_is_in_no_list():
    assert state_of(days_ago(2), None, NOW) is None
    assert state_of(days_ago(GRACE_DAYS) + timedelta(seconds=1), None, NOW) is None


def test_exactly_grace_days_without_use_is_dormant():
    assert state_of(days_ago(GRACE_DAYS), None, NOW) == "dormant"


def test_an_old_word_with_no_usage_row_is_dormant():
    assert state_of(days_ago(200), None, NOW) == "dormant"


def test_no_use_in_the_window_makes_it_dormant_and_the_boundary_is_strict():
    assert state_of(days_ago(200), Usage(days_ago(DORMANT_DAYS + 1), 5, 3), NOW) == "dormant"
    assert state_of(days_ago(200), Usage(days_ago(DORMANT_DAYS), 1, 1), NOW) == "sprouting"


def test_one_use_in_one_session_is_sprouting():
    assert state_of(days_ago(10), Usage(days_ago(1), 1, 1), NOW) == "sprouting"


def test_a_second_session_inside_the_window_makes_it_active():
    assert state_of(days_ago(10), Usage(days_ago(1), 3, ACTIVE_SESSIONS - 1), NOW) == "sprouting"
    assert state_of(days_ago(10), Usage(days_ago(1), 3, ACTIVE_SESSIONS), NOW) == "active"


def test_a_fresh_use_counts_even_before_the_grace_period_ends():
    assert state_of(days_ago(1), Usage(days_ago(0.1), 1, 1), NOW) == "sprouting"


def test_shadowing_never_changes_the_state():
    shadowed = Usage(days_ago(1), 0, 0, shadow_count=9)
    assert state_of(days_ago(200), shadowed, NOW) == "dormant"
    assert state_of(days_ago(2), shadowed, NOW) is None


def test_session_keys_are_short_hex_and_do_not_contain_the_id():
    key = session_key("conv", "conv-id-XYZ-123")
    assert len(key) == 16 and all(c in "0123456789abcdef" for c in key)
    assert "XYZ" not in key and "conv-id" not in key
    assert session_key("conv", "a") != session_key("conv", "b")
