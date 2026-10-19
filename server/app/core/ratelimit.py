import time
from collections import defaultdict, deque
from collections.abc import Callable


class RateLimiter:
    """进程内滑动窗口限流器。仅适用于单 worker 部署。"""

    def __init__(self, limit: int, window: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.window = window
        self._clock = clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._last_sweep = clock()

    def _sweep(self, now: float) -> None:
        if now - self._last_sweep < self.window:
            return
        self._last_sweep = now
        for key in [k for k, h in self._hits.items() if not h or now - h[-1] >= self.window]:
            del self._hits[key]

    def allow(self, key: str, limit: int | None = None) -> bool:
        """`limit` overrides `self.limit` for this key (per-user quota overrides)."""
        effective = self.limit if limit is None else limit
        now = self._clock()
        self._sweep(now)
        hits = self._hits[key]
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        if not hits:
            del self._hits[key]
        if len(hits) >= effective:
            return False
        self._hits[key].append(now)
        return True

    def exhausted(self, key: str, limit: int | None = None) -> bool:
        """True when `key` already has `limit` hits in the window. Read only: nothing is recorded, so a caller can
        refuse before doing any work and then count only the failures (invites v2 R-I5)."""
        effective = self.limit if limit is None else limit
        now = self._clock()
        hits = self._hits.get(key)
        if not hits:
            return effective <= 0
        return sum(1 for t in hits if now - t < self.window) >= effective
