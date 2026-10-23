"""Chat-home user prefs (plan 2026-10-23 §4): defaults, per-key validation, storage (chat_prefs, one JSON row).
Reads drop invalid old keys; writes are strict (unknown key or bad value -> PrefsInvalid carrying the key name)."""
from dataclasses import asdict, dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.personas import ID_RE
from app.models import ChatPrefs as ChatPrefsRow, utcnow

TRIGGERS = ("daily", "every_open", "off")
LANGUAGES = ("zh", "en", "bilingual")
DEFAULT_PERSONA_ID = "builtin:partner"


class PrefsInvalid(ValueError):
    def __init__(self, field: str):
        super().__init__(field)
        self.field = field


@dataclass(frozen=True)
class Prefs:
    greeting_trigger: str = "daily"
    language: str = "bilingual"
    daily_persona_id: str = DEFAULT_PERSONA_ID
    include_stats: bool = True

    def out(self) -> dict:
        return asdict(self)


DEFAULTS = Prefs()


def _check(key: str, value):
    if key == "greeting_trigger" and isinstance(value, str) and value in TRIGGERS:
        return value
    if key == "language" and isinstance(value, str) and value in LANGUAGES:
        return value
    if key == "daily_persona_id" and isinstance(value, str) and ID_RE.fullmatch(value):
        return value
    if key == "include_stats" and isinstance(value, bool):
        return value
    raise PrefsInvalid(key if key in DEFAULTS.out() else "unknown")


def merge(base: Prefs, patch: dict, *, strict: bool) -> Prefs:
    values = asdict(base)
    for key, raw in patch.items():
        try:
            values[key] = _check(key, raw)
        except PrefsInvalid:
            if strict:
                raise
    return Prefs(**values)


async def load(session: AsyncSession, user_id: int) -> Prefs:
    row = await session.get(ChatPrefsRow, user_id)
    if row is None or not isinstance(row.data, dict):
        return DEFAULTS
    return merge(DEFAULTS, row.data, strict=False)


async def save(session: AsyncSession, user_id: int, patch: dict) -> Prefs:
    """Validate the patch strictly, merge with the stored values, write the whole row back (flush only; the route commits)."""
    if not isinstance(patch, dict):
        raise PrefsInvalid("body")
    new = merge(await load(session, user_id), patch, strict=True)
    row = await session.get(ChatPrefsRow, user_id)
    if row is None:
        session.add(ChatPrefsRow(user_id=user_id, data=new.out(), updated_at=utcnow()))
    else:
        row.data = new.out()
        row.updated_at = utcnow()
    await session.flush()
    return new
