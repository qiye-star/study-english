"""昵称规则(INDEX X8)。纯函数:不读设置、不记录日志;错误文案固定,不回显输入。"""
import re
import unicodedata

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User

MAX_LENGTH = 20  # code points
# 房间里 @ai 的保留名。与 rooms/agent_config.RESERVED_NAMES({"ai", "助手"})及 rooms/store.AI_NAME("AI 助手")一致;
# services 不导入 rooms,所以这里写一份并在变更时同步。比较方式同 rooms 的 _name_key(空白折叠 + casefold)。
RESERVED = frozenset({"ai", "助手", "ai 助手"})
# 不得冒充官方身份的词(casefold 后整词比较;含中文)。不求全,只挡最常见的冒充。
OFFICIAL = frozenset({
    "admin", "administrator", "root", "system", "support", "staff", "moderator", "official",
    "管理员", "客服", "官方", "系统", "运营", "站长",
})
_REFUSED_CATEGORIES = frozenset({"Cc", "Cf", "Co", "Cs", "Zl", "Zp"})
_SPACES = re.compile(r"\s+")
_INVALID = "invalid nickname"
# 跨用户规则(需要查库)失败时返回的 422 文案:与上面的校验错误经全局处理器后的文案逐字相同
# ("nickname: " + pydantic 的 "Value error, " + _INVALID),不暴露是哪条规则、不回显输入。
INVALID_DETAIL = f"nickname: Value error, {_INVALID}"


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
    folded = text.casefold()
    if folded in RESERVED or folded in OFFICIAL:
        raise ValueError(_INVALID)
    return text


async def nickname_taken_by_login(session: AsyncSession, nickname: str, user_id: int | None) -> bool:
    """True when the (already cleaned) nickname equals ANOTHER user's login name, compared case-insensitively.
    The user's own login name is fine; `user_id=None` (registration) excludes nobody. Reads only; never logs."""
    key = unicodedata.normalize("NFC", nickname).casefold()
    query = select(User.id).where(func.lower(User.username) == key)
    if user_id is not None:
        query = query.where(User.id != user_id)
    return (await session.execute(query.limit(1))).first() is not None
