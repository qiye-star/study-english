import json
from pathlib import Path

import pytest

from app.rooms.codes import generate_code, is_weak, normalize_code
from app.rooms.rules import MAX_TEXT, RoomLimits, clean_text, mention
from tests.conftest import make_settings

MENTIONS = json.loads((Path(__file__).parent / "fixtures" / "room_mentions.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("raw,expected", [
    ("482913", "482913"), (" 482 913 ", "482913"), ("４８２９１３", "482913"),
    ("012345", None), ("12345", None), ("1234567", None), ("48291a", None), ("", None),
])
def test_normalize_code(raw, expected):
    assert normalize_code(raw) == expected


def test_weak_codes_and_generation_skips_them():
    assert all(is_weak(c) for c in ("111111", "123456", "987654", "456789"))
    assert not is_weak("482913")
    draws = iter([11111, 382913])
    assert generate_code(lambda n: next(draws)) == "482913"
    assert all(len(generate_code()) == 6 for _ in range(50))


def test_clean_text():
    assert clean_text("  hello\n\tworld\x07 ") == "hello world"
    assert clean_text("\x00 \n ") is None
    assert len(clean_text("a" * 900)) == MAX_TEXT
    assert clean_text("巧克力" * 300, 10) == "巧克力巧克力巧克力巧"


@pytest.mark.parametrize("case", MENTIONS, ids=[c["text"] for c in MENTIONS])
def test_mentions_match_the_shared_fixture(case):
    assert mention(case["text"]) == (case["ai"], case["question"])


def test_limits_from_settings():
    limits = RoomLimits.from_settings(make_settings(rooms_max_members=5, rooms_ai_per_room_hour=0))
    assert (limits.max_members, limits.ai_per_room_hour, limits.say_per_minute) == (5, 0, 20)
    assert (limits.retention_days, limits.mine_closed_days) == (0, 7)  # messages are kept forever by default
