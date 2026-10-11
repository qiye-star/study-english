"""已学词与自由复习的纯规则(spec 2026-10-12 wordbook-review §1;无 I/O)。

存储盒子是 0–5(R-L1):新学 0–1、巩固中 2–3、熟练 4–5(熟练的下界 = plan.MASTERED_BOX)。"""
import base64
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from app.wordbook.plan import day_end

Tier = Literal["learning", "growing", "mastered"]
TIERS: dict[str, tuple[int, int]] = {"learning": (0, 1), "growing": (2, 3), "mastered": (4, 5)}
WEAK_MIN_LAPSES = 1   # R-L3:答错过
WEAK_MAX_BOX = 3      # 且还没站稳
PAGE_MAX = 50
PREFIX_MAX = 30
FREE_COUNTS = (10, 20, 50)
FREE_SCOPES = ("yesterday", "last7", "book", "tier", "weak", "all")
FREE_MODES = ("browse", "recall", "choice", "spell")


def tier_of(box: int) -> str:
    for name, (low, high) in TIERS.items():
        if low <= box <= high:
            return name
    return "mastered" if box > 5 else "learning"


def is_weak(box: int, lapses: int) -> bool:
    return lapses >= WEAK_MIN_LAPSES and box <= WEAK_MAX_BOX


def encode_cursor(at: datetime, item_id: str) -> str:
    """游标 = (created_at, id) 的 base64url;不含词。"""
    raw = f"{at.astimezone(timezone.utc).isoformat()}|{item_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(text: str) -> tuple[datetime, str] | None:
    try:
        raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4)).decode()
        stamp, item_id = raw.split("|", 1)
        at = datetime.fromisoformat(stamp)
    except ValueError:  # binascii.Error、UnicodeDecodeError、拆包失败都是 ValueError
        return None
    return (at, item_id) if at.tzinfo is not None and item_id else None


def scope_window(scope: str, now: datetime, offset: int) -> tuple[datetime | None, datetime | None]:
    """(起, 止) 的 UTC 时刻,止不含;None = 不限。昨天 = 本地昨天;最近 7 天 = 本地今天往前 7 个本地日(含今天)。"""
    if scope == "yesterday":
        return day_end(now, offset, -2), day_end(now, offset, -1)
    if scope == "last7":
        return day_end(now, offset, -7), None
    return None, None


def _local_midnight(day: str, offset: int) -> datetime:
    d = date.fromisoformat(day)  # 坏日期抛 ValueError
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc) - timedelta(minutes=offset)


def date_bounds(since: str | None, until: str | None, offset: int) -> tuple[datetime | None, datetime | None]:
    """学习日期范围(本地日,首尾都含)→ UTC 半开区间 [起, 止)。"""
    start = _local_midnight(since, offset) if since else None
    end = _local_midnight(until, offset) + timedelta(days=1) if until else None
    return start, end
