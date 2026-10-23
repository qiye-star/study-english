"""纯函数:已学词的三种状态与会话标识(plan L4 R8、R2)。阈值是占位,未用真实用户数据校准,不是设置项。

状态(只看主动使用计数,影子跟读不计入 — R7):
- 沉睡 dormant:已学满 GRACE_DAYS 天,且窗口(DORMANT_DAYS)内没有主动使用(无计数行,或最后一次使用早于窗口);
- 萌芽 sprouting:窗口内用过(use_count ≥ 1),但只在不到 ACTIVE_SESSIONS 个会话里;
- 激活 active:窗口内在 ACTIVE_SESSIONS 个以上会话里用过;
- None:刚学(未满宽限期且没用过)——不进任何列表。
"""
import hashlib
from datetime import datetime, timedelta
from typing import Any

GRACE_DAYS = 3  # 占位
DORMANT_DAYS = 30  # 占位
ACTIVE_SESSIONS = 2  # 占位


def session_key(kind: str, session_id: str) -> str:
    """会话标识的摘要(sha256 前 16 位十六进制):只用来判断「换了会话没有」,原 id 不落库。"""
    return hashlib.sha256(f"{kind}:{session_id}".encode("utf-8")).hexdigest()[:16]


def state_of(learned_at: datetime, usage: Any | None, now: datetime) -> str | None:
    """`usage` 为 None 或带 last_used_at / use_count / session_count 的对象(WordUsage 行或等价物)。"""
    window_start = now - timedelta(days=DORMANT_DAYS)
    if usage is not None and usage.use_count >= 1 and usage.last_used_at >= window_start:
        return "active" if usage.session_count >= ACTIVE_SESSIONS else "sprouting"
    if learned_at <= now - timedelta(days=GRACE_DAYS):
        return "dormant"
    return None
