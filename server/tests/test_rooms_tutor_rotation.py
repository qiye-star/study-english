# server/tests/test_rooms_tutor_rotation.py
from datetime import datetime, timedelta, timezone

from app.models import iso_utc
from app.rooms.tutor_rotation import clamp_steps, initial_order, next_participant, remaining_ms

NOW = datetime(2026, 10, 12, 9, tzinfo=timezone.utc)


def test_steps_are_clamped_to_spec_range():
    assert [clamp_steps(n) for n in (None, 1, 3, 8, 12, 50)] == [8, 3, 3, 8, 12, 12]


def test_initial_order_is_online_members_in_join_order():
    assert initial_order([1, 2, 3, 4], {4, 2}) == [2, 4]
    assert initial_order([1, 2], set()) == []


def test_rotation_cycles_skips_leavers_and_appends_newcomers():
    order = [1, 2, 3]
    assert next_participant(order, None, [1, 2, 3]) == ([1, 2, 3], 1)
    assert next_participant(order, 1, [1, 2, 3]) == ([1, 2, 3], 2)
    assert next_participant(order, 3, [1, 2, 3]) == ([1, 2, 3], 1)
    assert next_participant(order, 1, [1, 3]) == ([1, 2, 3], 3)  # 2 left the room
    assert next_participant(order, 3, [1, 2, 3, 9]) == ([1, 2, 3, 9], 9)  # 9 joined: last in the round
    assert next_participant([5], 5, [5]) == ([5], 5)  # alone: asked again
    assert next_participant(order, 2, []) == ([1, 2, 3], None)
    assert next_participant(order, 7, [2, 3]) == ([1, 2, 3], 2)  # unknown last: from the top


def test_remaining_ms_from_an_iso_deadline():
    assert remaining_ms(iso_utc(NOW + timedelta(seconds=42)), NOW) == 42_000
    assert remaining_ms(iso_utc(NOW - timedelta(seconds=1)), NOW) == 0
    assert remaining_ms(None, NOW) is None
