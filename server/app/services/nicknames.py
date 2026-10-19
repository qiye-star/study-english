"""昵称规则(INDEX X8)。纯函数:不读设置、不记录日志;错误文案固定,不回显输入。"""
import re
import unicodedata

MAX_LENGTH = 20  # code points
# 房间里 @ai 的保留名。与 rooms/agent_config.RESERVED_NAMES({"ai", "助手"})及 rooms/store.AI_NAME("AI 助手")一致;
# services 不导入 rooms,所以这里写一份并在变更时同步。比较方式同 rooms 的 _name_key(空白折叠 + casefold)。
RESERVED = frozenset({"ai", "助手", "ai 助手"})
_REFUSED_CATEGORIES = frozenset({"Cc", "Cf", "Co", "Cs", "Zl", "Zp"})
_SPACES = re.compile(r"\s+")
_INVALID = "invalid nickname"


def clean_nickname(raw: str) -> str:
    """NFC, refuse control / format / private-use / surrogate / line-separator characters, fold runs of
    whitespace to one space, then check length, leading '@' and reserved names."""
    if not isinstance(raw, str):
        raise ValueError(_INVALID)
    text = unicodedata.normalize("NFC", raw)
    if any(unicodedata.category(ch) in _REFUSED_CATEGORIES for ch in text):
        raise ValueError(_INVALID)
    text = _SPACES.sub(" ", text).strip()
    if not text or len(text) > MAX_LENGTH or text.startswith("@"):
        raise ValueError(_INVALID)
    if text.casefold() in RESERVED:
        raise ValueError(_INVALID)
    return text
