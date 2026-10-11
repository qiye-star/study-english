"""线程内记忆块快照(spec §6.3 前缀稳定,裁定 R-M5):同一用户 + 线程 + 角色,5 分钟内复用同一块文本。

用户在记忆页的任何写操作调用 invalidate_user(删掉的记忆立刻不再进提示词);后台整理写入的新记忆不作废快照。
单进程内存、LRU 上限 5000 条;多进程部署时各进程各自缓存(最多 5 分钟不一致)。"""
import time
from collections import OrderedDict
from collections.abc import Callable

from app.agents.memory.retrieve import MemoryBlock

SNAPSHOT_TTL_SECONDS = 300.0
SNAPSHOT_MAX_ENTRIES = 5000
Key = tuple[int, str, str, str]  # (user_id, thread kind, thread id, persona id)


class SnapshotCache:
    def __init__(self, ttl_seconds: float = SNAPSHOT_TTL_SECONDS, max_entries: int = SNAPSHOT_MAX_ENTRIES,
                 clock: Callable[[], float] = time.monotonic):
        self._ttl, self._max, self._clock = ttl_seconds, max_entries, clock
        self._entries: OrderedDict[Key, tuple[float, MemoryBlock]] = OrderedDict()

    def get(self, key: Key) -> MemoryBlock | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        at, block = entry
        if self._clock() - at > self._ttl:
            del self._entries[key]
            return None
        self._entries.move_to_end(key)
        return block

    def put(self, key: Key, block: MemoryBlock) -> None:
        self._entries[key] = (self._clock(), block)
        self._entries.move_to_end(key)
        while len(self._entries) > self._max:
            self._entries.popitem(last=False)

    def invalidate_user(self, user_id: int) -> None:
        for key in [k for k in self._entries if k[0] == user_id]:
            del self._entries[key]
