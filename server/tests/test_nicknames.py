"""昵称规则的纯函数(计划 S6;INDEX X8)。"""
import pytest

from app.services.nicknames import clean_nickname

ALLOWED = [
    ("小明", "小明"),
    ("Emma Lee", "Emma Lee"),
    ("  Emma   Lee ", "Emma Lee"),
    ("小明😀", "小明😀"),
    ("é", "é"),  # decomposed input is stored in NFC
    ("é", "é"),
    ("一" * 20, "一" * 20),
    ("Admin Lee", "Admin Lee"),  # only an exact official word is refused
    ("官方旗舰", "官方旗舰"),  # 20 code points is the limit
]

REJECTED = [
    "",
    "   ",
    "一" * 21,
    "​X",  # zero-width space (Cf)
    "a\nb",  # control characters are refused, not folded into a space
    "a\tb",
    "\x07",
    "@Emma",
    "AI",
    "ai",
    "Ai",
    "助手",
    "AI 助手",
    "ai   助手",
    # official words (S6b): casefolded, whitespace-trimmed
    "admin",
    "Admin",
    "ADMINISTRATOR",
    "  Root  ",
    "system",
    "Support",
    "staff",
    "Moderator",
    "OFFICIAL",
    "管理员",
    "客服",
    "官方",
    "系统",
    "运营",
    "站长",
    "",  # private use (Co)
    "a b",  # line separator (Zl)
]


@pytest.mark.parametrize("raw, expected", ALLOWED)
def test_allowed_nicknames_are_normalised(raw, expected):
    assert clean_nickname(raw) == expected


@pytest.mark.parametrize("raw", REJECTED)
def test_rejected_nicknames_raise_a_fixed_message(raw):
    with pytest.raises(ValueError) as info:
        clean_nickname(raw)
    assert str(info.value) == "invalid nickname"


def test_rejection_message_never_echoes_the_input():
    with pytest.raises(ValueError) as info:
        clean_nickname("@SecretNick")
    assert "SecretNick" not in str(info.value)


def test_reserved_names_match_the_rooms_constants():
    """services cannot import rooms (layering), so the set is copied; this test keeps the two in sync."""
    from app.rooms.agent_config import RESERVED_NAMES
    from app.rooms.store import AI_NAME
    from app.services.nicknames import RESERVED

    assert RESERVED == frozenset(RESERVED_NAMES) | {AI_NAME.casefold()}


def test_official_words_are_a_casefolded_frozenset():
    from app.services.nicknames import OFFICIAL

    assert OFFICIAL == frozenset({"admin", "administrator", "root", "system", "support", "staff", "moderator",
                                  "official", "管理员", "客服", "官方", "系统", "运营", "站长"})
