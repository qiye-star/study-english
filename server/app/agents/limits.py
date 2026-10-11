"""上限与幂等(spec 2026-10-12-agents §4.4、§10.1;计划 R-C6、R-C7、R-C11、R-C13):每日回合额度(services.usage 的
daily_usage,跨重启;每人可按用户覆盖)、自建角色上限、工具方式回落、进程内回合幂等账本。只记作用域与数字。"""
import hashlib
import json
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime

from app.core.quotas import effective
from app.services import usage

TEXT_MAX_CHARS = 2000
HISTORY_HARD_MAX = 50  # 请求体里 history 的硬上限;再按 AGENTS_HISTORY_MAX 夹取
CHAT_TEMPERATURE = 0.7
CONCURRENT_TURNS_PER_USER = 2
LEDGER_TTL_SECONDS = 600
RUNNING_TTL_SECONDS = 180  # 评审 #3:一个 running 条目最多挂这么久(大于模型总期限 llm.STREAM_TOTAL_SECONDS),丢了也不会堵住用户
LEDGER_MAX = 2000

SCOPE_TURNS_USER = "agents_turns"
SCOPE_TURNS_GLOBAL = "agents_turns_global"
SCOPE_TUTOR_USER = "agents_tutor"  # 计划 A3:开始一次导师会话 +1(每人)
SCOPE_MEMORY_USER = "agents_memory_extract"  # 计划 A2:一次记忆整理 +1(每人)
SCOPE_PERSONA_REPORTS = "agents_persona_reports"
GLOBAL_SUBJECT = "*"


async def consume_turn(session, quota_source, settings, user_id: int, now: datetime) -> str | None:
    """先扣每人(可覆盖),再扣全站;全站失败退还每人。None = 已扣。usage.consume 会提交 session。"""
    day = usage.utc_day(now)
    per_user = await effective(session, quota_source, user_id, "agents_turns_daily_per_user")
    if not await usage.consume(session, SCOPE_TURNS_USER, str(user_id), day, per_user):
        return "user_cap"
    if not await usage.consume(session, SCOPE_TURNS_GLOBAL, GLOBAL_SUBJECT, day, settings.agents_turns_global_daily):
        await usage.refund(session, SCOPE_TURNS_USER, str(user_id), day)
        return "global_cap"
    return None


async def refund_turn(session, user_id: int, now: datetime) -> None:
    day = usage.utc_day(now)
    await usage.refund(session, SCOPE_TURNS_USER, str(user_id), day)
    await usage.refund(session, SCOPE_TURNS_GLOBAL, GLOBAL_SUBJECT, day)


async def personas_cap(session, quota_source, user_id: int) -> int:
    return await effective(session, quota_source, user_id, "agents_personas_max")


def effective_tools_mode(settings, probe: dict | None) -> str:
    """native 只有在函数调用探测通过后才生效,否则回落 prefetch(spec §6.2;R-C7:生效后行为暂与 prefetch 相同)。"""
    mode = settings.agents_tools_mode
    if mode == "native" and not (probe or {}).get("ok"):
        return "prefetch"
    return mode


@dataclass
class LedgerEntry:
    user_id: int
    state: str  # running | done
    at: float
    replay: list = field(default_factory=list)  # done:Start + Delta(全文) + Meta? + Done(只在内存)
    fingerprint: str = ""  # 评审 #9:请求指纹(见 fingerprint());同一 client_turn_id 必须是同一个请求


def fingerprint(persona_id: str, conversation_id: str | None, text: str | None, mode: str,
                tutor_session_id: str | None) -> str:
    """幂等键绑定的请求内容(评审 #9);只存哈希,账本里没有文本。"""
    raw = json.dumps([persona_id, conversation_id, text, mode, tutor_session_id], ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class TurnLedger:
    """client_turn_id 幂等(进程内;R-C6)。running → 409;done(TTL 内)→ 重放;同一用户 running ≥ 2 → busy;
    指纹不同 → mismatch(409)。running 条目 RUNNING_TTL_SECONDS 后失效(没人收尾也不会堵住用户)。"""

    def __init__(self, ttl: float = LEDGER_TTL_SECONDS, max_items: int = LEDGER_MAX, clock=time.monotonic):
        self._ttl, self._max, self._clock = ttl, max_items, clock
        self._items: OrderedDict[tuple[int, str], LedgerEntry] = OrderedDict()

    def __len__(self) -> int:
        return len(self._items)

    def _prune(self) -> None:
        now = self._clock()
        for key in [k for k, e in self._items.items()
                    if e.at < now - (min(self._ttl, RUNNING_TTL_SECONDS) if e.state == "running" else self._ttl)]:
            del self._items[key]
        while len(self._items) > self._max:
            self._items.popitem(last=False)

    def begin(self, user_id: int, client_turn_id: str, fp: str = "") -> tuple[str, LedgerEntry | None]:
        self._prune()
        key = (user_id, client_turn_id)
        entry = self._items.get(key)
        if entry is not None:
            if entry.fingerprint != fp:
                return "mismatch", None
            return entry.state, entry
        running = sum(1 for e in self._items.values() if e.user_id == user_id and e.state == "running")
        if running >= CONCURRENT_TURNS_PER_USER:
            return "busy", None
        entry = self._items[key] = LedgerEntry(user_id, "running", self._clock(), fingerprint=fp)
        self._prune()
        return "new", entry

    def finish(self, user_id: int, client_turn_id: str, replay: list) -> None:
        key = (user_id, client_turn_id)
        old = self._items.get(key)
        self._items[key] = LedgerEntry(user_id, "done", self._clock(), list(replay),
                                       old.fingerprint if old is not None else "")
        self._items.move_to_end(key)
        self._prune()

    def drop(self, user_id: int, client_turn_id: str) -> None:
        self._items.pop((user_id, client_turn_id), None)

    def release(self, user_id: int, client_turn_id: str, entry: LedgerEntry | None) -> None:
        """没走到 done 的收尾(含流从未开始 / 被取消):只删还是自己、还在 running 的那条。"""
        key = (user_id, client_turn_id)
        if entry is not None and self._items.get(key) is entry and entry.state == "running":
            del self._items[key]
