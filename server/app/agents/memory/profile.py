"""用户档案:固定六个键、逐键校验;用户编辑过的键记入 edited_keys,智能体对这些键只能提议(spec §8.1,裁定 R-M8)。

键名都是单个英文单词:网页 ApiClient 会把响应里的键转成 camelCase,而 edited_keys 里的值不会被转换(裁定 R-M7)。"""
from app.agents.memory.tombstones import clean_text, unsafe_reason

PROFILE_KEYS = ("level", "goals", "interests", "native", "correction", "schedule")
LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
CORRECTIONS = ("gentle", "direct", "asked")
LISTS = {"goals": (5, 40), "interests": (8, 20)}  # (最多几项, 每项最多几个字)
TEXTS = {"native": 20, "schedule": 40}
LABELS = {"level": "level", "goals": "goals", "interests": "interests", "native": "native language",
          "correction": "correction preference", "schedule": "study time"}


class ProfileError(ValueError):
    def __init__(self, key: object):
        super().__init__(str(key))
        self.key = key


def _text(key: str, value: object, limit: int) -> str:
    if not isinstance(value, str):
        raise ProfileError(key)
    text = clean_text(value)
    if not text or len(text) > limit or unsafe_reason(text):
        raise ProfileError(key)
    return text


def clean_value(key: object, value: object) -> object | None:
    """合法值(已清洗);None = 删除这个键。不合法 → ProfileError(key)。"""
    if not isinstance(key, str) or key not in PROFILE_KEYS:
        raise ProfileError(key)
    if value is None:
        return None
    if key == "level":
        if not isinstance(value, str) or value not in LEVELS:
            raise ProfileError(key)
        return value
    if key == "correction":
        if not isinstance(value, str) or value not in CORRECTIONS:
            raise ProfileError(key)
        return value
    if key in LISTS:
        most, limit = LISTS[key]
        if not isinstance(value, list) or len(value) > most:
            raise ProfileError(key)
        out: list[str] = []
        for entry in value:
            text = _text(key, entry, limit)
            if text.casefold() not in {o.casefold() for o in out}:
                out.append(text)
        return out or None
    return _text(key, value, TEXTS[key])


def apply_user_patch(data: dict, edited: list, proposals: dict, values: dict,
                     dismiss: list) -> tuple[dict, list, dict]:
    """用户的修改:写入(None = 删除该键)、记入 edited_keys、清掉同键提议;dismiss 只清提议。"""
    data, edited, proposals = dict(data), list(edited), dict(proposals)
    for key in dismiss:
        if not isinstance(key, str) or key not in PROFILE_KEYS:
            raise ProfileError(key)
        proposals.pop(key, None)
    for key, raw in values.items():
        value = clean_value(key, raw)
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value
        proposals.pop(key, None)
        if key not in edited:
            edited.append(key)
    return data, sorted(edited, key=PROFILE_KEYS.index), proposals


def apply_proposal(data: dict, edited: list, proposals: dict, key: str, raw: object) -> tuple[dict, dict, str]:
    """智能体的修改:用户没编辑过 → 直接写入("applied");编辑过 → 只记为提议("proposed");
    相同或删除 → "same"(智能体不能删除档案键)。"""
    value = clean_value(key, raw)
    if value is None or data.get(key) == value:
        return dict(data), dict(proposals), "same"
    if key in edited:
        return dict(data), {**proposals, key: value}, "proposed"
    return {**data, key: value}, dict(proposals), "applied"


def profile_line(data: dict) -> str:
    parts = []
    for key in PROFILE_KEYS:
        value = data.get(key)
        if value in (None, "", []):
            continue
        parts.append(f"{LABELS[key]}: {', '.join(value) if isinstance(value, list) else value}")
    return "; ".join(parts)
