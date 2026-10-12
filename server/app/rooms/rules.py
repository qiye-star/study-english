"""Pure room rules: text cleaning, @ai parsing, limits (spec 2026-10-09 §5.4, §5.6)."""
import re
from dataclasses import dataclass

from app.rooms.protocol import MAX_AGENTS
from app.rooms.scenarios import SCENARIOS

MAX_TEXT = 500
MAX_TOPIC = 100
LEVELS = ("A1", "A2", "B1", "B2", "C1")  # room target levels (spec 2026-10-10 §3.1)
# Mirrors app.rank.tiers TIERS[*].cefr; rooms must not import rank (tests/test_architecture.py).
CEFR_BY_TIER = ("A1", "A2", "B1", "B1+", "B2", "C1", "C1+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_MENTION = re.compile(r"^@(?:ai|助手)(?=$|[\s:：,，])[\s:：,，]*", re.IGNORECASE)


def clean_text(raw: str, limit: int = MAX_TEXT) -> str | None:
    text = " ".join(_CONTROL.sub(" ", raw or "").split())
    text = text[:limit].strip()
    return text or None


JOIN_MODES = ("code", "approval")
SETTING_FIELDS = ("name", "scenario", "level", "join_mode", "max_members", "ai_public", "allow_voice")
NAME_MAX = 30
MIN_MEMBERS = 2
MAX_MEMBERS_CAP = 8  # spec 2026-10-10 §3.1: 2–8 and never above the site ROOMS_MAX_MEMBERS
# A persona id: a builtin key or a lowercase uuid4 (agents spec §4.2). Shape only; existence is checked by
# agent_config.validate against the owner (plan 2026-10-12-agents-rooms R-RA3).
_PERSONA_ID = re.compile(
    r"^(?:builtin:[a-z][a-z0-9_]{0,31}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$")
# Tier index -> default room level (spec R2-20: B1+ -> B1, C1+ -> C1); mirrors CEFR_BY_TIER without the "+".
_LEVEL_BY_TIER = ("A1", "A2", "B1", "B1", "B2", "C1", "C1")


def is_persona_id(value: object) -> bool:
    """The shape of a persona id (a builtin key or a lowercase uuid4). Membership in a room's agents is checked by the
    caller against the room's config (addressing R-AS7)."""
    return isinstance(value, str) and _PERSONA_ID.fullmatch(value) is not None


@dataclass(frozen=True)
class RoomSettings:
    """The seven creation settings (spec 2026-10-10 §3.1)."""
    name: str
    scenario: str
    level: str
    join_mode: str
    max_members: int
    ai_public: bool
    allow_voice: bool


def default_level(tier: int | None) -> str:
    """The creator's rank tier as a room level; no rank profile (or an unknown tier) -> A2."""
    if tier is None or not 0 <= tier < len(_LEVEL_BY_TIER):
        return "A2"
    return _LEVEL_BY_TIER[tier]


def clean_settings(raw: dict, *, site_max_members: int, partial: bool) -> tuple[dict, dict[str, str]]:
    """Validate the settings present in `raw` -> (clean values, {field: error code}). Unknown keys are ignored.
    A blank name is left out (create: the store fills the default; edit: no change). `partial` only matters for
    the caller: both modes check exactly the keys that are present."""
    values: dict = {}
    errors: dict[str, str] = {}
    if raw.get("name") is not None:
        name = clean_text(str(raw["name"]), 10 * NAME_MAX)  # count code points after cleaning whitespace/controls
        if name is not None and len(name) > NAME_MAX:
            errors["name"] = "too_long"
        elif name is not None:
            values["name"] = name
    if raw.get("scenario") is not None:
        if raw["scenario"] in {s.key for s in SCENARIOS}:
            values["scenario"] = raw["scenario"]
        else:
            errors["scenario"] = "unknown"
    if raw.get("level") is not None:
        if raw["level"] in LEVELS:
            values["level"] = raw["level"]
        else:
            errors["level"] = "unknown"
    if raw.get("join_mode") is not None:
        if raw["join_mode"] in JOIN_MODES:
            values["join_mode"] = raw["join_mode"]
        else:
            errors["join_mode"] = "unknown"
    if raw.get("max_members") is not None:
        size = raw["max_members"]
        if isinstance(size, int) and not isinstance(size, bool) and                 MIN_MEMBERS <= size <= min(MAX_MEMBERS_CAP, site_max_members):
            values["max_members"] = size
        else:
            errors["max_members"] = "range"
    for key in ("ai_public", "allow_voice"):
        if raw.get(key) is not None:
            values[key] = bool(raw[key])
    if raw.get("agents") is not None:  # owner only: ADMIN_SETTING_FIELDS never passes it (R-RA3)
        ids = raw["agents"]
        if not isinstance(ids, list) or not all(isinstance(i, str) and _PERSONA_ID.match(i) for i in ids):
            errors["agents"] = "invalid"
        elif len(ids) > MAX_AGENTS:
            errors["agents"] = "too_many"
        elif len(set(ids)) != len(ids):
            errors["agents"] = "duplicate"
        else:
            values["agents"] = list(ids)
    return values, errors


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
    mine_closed_days: int = 7  # DEPRECATED (R-O4): no longer used; GET /api/rooms/mine lists open rooms only
    assist_daily: int = 60
    assist_per_minute: int = 10
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
    # ---- rooms v2 (spec 2026-10-10 §11.2 fixed values; the settings-backed ones are mapped below) ----
    voice_per_minute: int = 6
    voice_daily: int = 100
    voice_global_daily: int = 3000
    voice_max_ms: int = 60_000
    voice_min_ms: int = 500
    voice_attempts: int = 3
    voice_quota_mb: int = 200
    translate_per_minute: int = 20
    translate_global_daily: int = 3000
    translate_attempts: int = 3
    retry_per_minute: int = 6
    react_per_minute: int = 30
    typing_interval: float = 1.0
    join_pending_per_room: int = 20
    join_request_minutes: int = 10
    join_deny_cooldown_minutes: int = 30
    summary_min_messages: int = 6
    summary_context: int = 150
    summary_max_chars: int = 12_000
    summary_global_daily: int = 200
    summary_owner_daily: int = 10  # per room owner per UTC day: one account cannot drain the site budget
    summary_attempts: int = 2
    staging_keep_days: int = 7
    default_max_members: int = 4
    name_max: int = 30
    reopen_per_minute: int = 5  # per user (R-O10), fixed value like react_per_minute

    @classmethod
    def from_settings(cls, s) -> "RoomLimits":
        return cls(max_members=s.rooms_max_members, max_active=s.rooms_max_active, max_owned=s.rooms_max_owned,
                   idle_minutes=s.rooms_idle_minutes, max_hours=s.rooms_max_hours,
                   retention_days=s.room_message_retention_days, assist_daily=s.rooms_assist_daily_per_user,
                   ai_per_room_hour=s.rooms_ai_per_room_hour, ai_global_daily=s.rooms_ai_global_daily,
                   voice_daily=s.rooms_voice_daily_per_user, voice_global_daily=s.rooms_voice_global_daily,
                   voice_max_ms=s.rooms_voice_max_seconds * 1000, voice_quota_mb=s.rooms_voice_quota_mb,
                   translate_global_daily=s.rooms_translate_global_daily,
                   summary_global_daily=s.rooms_summary_global_daily)
