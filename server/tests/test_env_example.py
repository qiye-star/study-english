"""The tracked env sample documents the 10.21 lane flags, and every documented name is a real setting."""

import re
from pathlib import Path

from app.core.config import Settings

ENV_EXAMPLE = Path(__file__).resolve().parents[1] / ".env.example"

# name in .env (upper case) -> must exist as a Settings field
LANE_FLAGS = [
    "ACTIVATION_ENABLED",  # L4
    "DUBBING_ENABLED",  # L5
    "DUBBING_SUGGEST_DAILY_PER_USER",  # L5
    "WORDBOOK_FSRS_PCT",  # L3 (runtime setting; documented commented-out)
    "WORDBOOK_FSRS_RETENTION_PCT",  # L3
]


def _text() -> str:
    # read_text uses universal newlines, so the CRLF sample matches the same way as LF
    return ENV_EXAMPLE.read_text(encoding="utf-8")


def _documented(name: str, text: str) -> list[str]:
    # matches "NAME=..." or "# NAME=..." at the start of a line
    return re.findall(rf"^#? ?{name}=.*$", text, flags=re.MULTILINE)


def test_lane_flags_are_documented_in_env_example():
    text = _text()
    for name in LANE_FLAGS:
        assert _documented(name, text), f"{name} missing from .env.example"


def test_documented_lane_flags_match_real_settings():
    fields = set(Settings.model_fields)
    for name in LANE_FLAGS:
        assert name.lower() in fields, f"{name} is not a Settings field"


def test_lane_flags_ship_safe_defaults_in_the_sample():
    text = _text()
    assert re.search(r"^ACTIVATION_ENABLED=false$", text, flags=re.MULTILINE)
    assert re.search(r"^DUBBING_ENABLED=false$", text, flags=re.MULTILINE)
    assert re.search(r"^DUBBING_SUGGEST_DAILY_PER_USER=120$", text, flags=re.MULTILINE)
