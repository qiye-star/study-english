"""用户级智能体设置(spec 2026-10-12-agents §4.3):默认值、逐键校验、存取(agent_user_settings 一行 JSON)。
读时丢弃无效的旧键(不报错);写时严格(未知键或非法值 → SettingsInvalid)。process_default 固定 collapsed(D1,R-C24)。"""
from dataclasses import asdict, dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.context import TOOL_KEYS
from app.agents.personas import ID_RE
from app.models import AgentUserSettings, utcnow

TUTOR_KINDS = ("ask", "words", "repeat", "retell", "roleplay", "dictate")
TUTOR_LENGTH = (3, 12)
TUTOR_DEFAULT_LENGTH = 8
PROCESS_DEFAULT = "collapsed"
FLAGS = ("memory_enabled", "share_in_rooms", "show_process")
ZH_NOTES = ("auto", "always", "never")  # addressing §5.1: auto = write a Chinese note for A2 / B1 personas and questions


class SettingsInvalid(ValueError):
    def __init__(self, field: str):
        super().__init__(field)
        self.field = field


def _tutor_default() -> dict:
    return {"length": TUTOR_DEFAULT_LENGTH, "mix": list(TUTOR_KINDS)}


@dataclass(frozen=True)
class AgentSettings:
    tools: dict = field(default_factory=lambda: {k: True for k in TOOL_KEYS})
    memory_enabled: bool = True
    share_in_rooms: bool = True
    show_process: bool = True
    default_persona_id: str | None = None
    tutor: dict = field(default_factory=_tutor_default)
    zh_note: str = "auto"

    def out(self) -> dict:
        return {"tools": dict(self.tools), "memory_enabled": self.memory_enabled,
                "share_in_rooms": self.share_in_rooms, "show_process": self.show_process,
                "default_persona_id": self.default_persona_id,
                "tutor": {"length": self.tutor["length"], "mix": list(self.tutor["mix"])},
                "zh_note": self.zh_note, "process_default": PROCESS_DEFAULT}


DEFAULTS = AgentSettings()


def _check(key: str, value):
    if key == "tools":
        if not isinstance(value, dict) or any(k not in TOOL_KEYS or not isinstance(v, bool) for k, v in value.items()):
            raise SettingsInvalid("tools")
        return dict(value)
    if key in FLAGS:
        if not isinstance(value, bool):
            raise SettingsInvalid(key)
        return value
    if key == "default_persona_id":
        if value is not None and (not isinstance(value, str) or not ID_RE.fullmatch(value)):
            raise SettingsInvalid(key)
        return value
    if key == "tutor":
        if not isinstance(value, dict) or set(value) - {"length", "mix"}:
            raise SettingsInvalid("tutor")
        out = {}
        if "length" in value:
            n = value["length"]
            if isinstance(n, bool) or not isinstance(n, int) or not TUTOR_LENGTH[0] <= n <= TUTOR_LENGTH[1]:
                raise SettingsInvalid("tutor")
            out["length"] = n
        if "mix" in value:
            mix = value["mix"]
            if not isinstance(mix, list) or not mix or any(k not in TUTOR_KINDS for k in mix):
                raise SettingsInvalid("tutor")
            out["mix"] = [k for k in TUTOR_KINDS if k in mix]
        return out
    if key == "zh_note":
        if not isinstance(value, str) or value not in ZH_NOTES:
            raise SettingsInvalid("zh_note")
        return value
    if key == "process_default":
        raise SettingsInvalid("process_default")
    raise SettingsInvalid("unknown")


def merge(base: AgentSettings, patch: dict, *, strict: bool) -> AgentSettings:
    values = asdict(base)
    for key, raw in patch.items():
        try:
            value = _check(key, raw)
        except SettingsInvalid:
            if strict:
                raise
            continue
        if key == "tools":
            values["tools"] = {**values["tools"], **value}
        elif key == "tutor":
            values["tutor"] = {**values["tutor"], **value}
        else:
            values[key] = value
    values["tools"] = {k: bool(values["tools"].get(k, True)) for k in TOOL_KEYS}
    return AgentSettings(**values)


async def load(session: AsyncSession, user_id: int) -> AgentSettings:
    row = await session.get(AgentUserSettings, user_id)
    if row is None or not isinstance(row.data, dict):
        return DEFAULTS
    return merge(DEFAULTS, row.data, strict=False)


async def save(session: AsyncSession, user_id: int, patch: dict) -> AgentSettings:
    """严格校验 patch,与已存值合并后整行写回(只 flush;路由提交)。"""
    if not isinstance(patch, dict):
        raise SettingsInvalid("body")
    new = merge(await load(session, user_id), patch, strict=True)
    data = asdict(new)
    row = await session.get(AgentUserSettings, user_id)
    if row is None:
        session.add(AgentUserSettings(user_id=user_id, data=data, updated_at=utcnow()))
    else:
        row.data = data
        row.updated_at = utcnow()
    await session.flush()
    return new
