"""Pure room rules: text cleaning, @ai parsing, limits (spec 2026-10-09 §5.4, §5.6)."""
import re
from dataclasses import dataclass

MAX_TEXT = 500
MAX_TOPIC = 100
# Mirrors app.rank.tiers TIERS[*].cefr; rooms must not import rank (tests/test_architecture.py).
CEFR_BY_TIER = ("A1", "A2", "B1", "B1+", "B2", "C1", "C1+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_MENTION = re.compile(r"^@(?:ai|助手)(?=$|[\s:：,，])[\s:：,，]*", re.IGNORECASE)


def clean_text(raw: str, limit: int = MAX_TEXT) -> str | None:
    text = " ".join(_CONTROL.sub(" ", raw or "").split())
    text = text[:limit].strip()
    return text or None


def mention(text: str) -> tuple[bool, str]:
    """(True, question) when the message starts with @ai / @AI / @助手 and has a question after it."""
    stripped = (text or "").strip()
    match = _MENTION.match(stripped)
    if not match:
        return False, ""
    question = stripped[match.end():].strip()
    return (True, question) if question else (False, "")


@dataclass(frozen=True)
class RoomLimits:
    max_members: int = 8
    max_active: int = 50
    max_owned: int = 3
    idle_minutes: int = 30
    max_hours: int = 24
    retention_days: int = 0  # 0 = keep room messages forever; >0 = purge N days after close
    mine_closed_days: int = 7  # how long closed rooms stay listed in GET /api/rooms/mine
    assist_daily: int = 60
    ai_per_room_hour: int = 30
    ai_global_daily: int = 1000
    say_per_minute: int = 20
    ai_per_user_10min: int = 5
    ai_queue: int = 3
    replay_limit: int = 200
    assist_history: int = 10
    connections_per_user: int = 3
    dedupe_minutes: int = 5
    join_per_minute: int = 10

    @classmethod
    def from_settings(cls, s) -> "RoomLimits":
        return cls(max_members=s.rooms_max_members, max_active=s.rooms_max_active, max_owned=s.rooms_max_owned,
                   idle_minutes=s.rooms_idle_minutes, max_hours=s.rooms_max_hours,
                   retention_days=s.room_message_retention_days, assist_daily=s.rooms_assist_daily_per_user,
                   ai_per_room_hour=s.rooms_ai_per_room_hour, ai_global_daily=s.rooms_ai_global_daily)
