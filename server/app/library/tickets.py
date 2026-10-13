"""媒体播放票据(spec §10、E4):`<video>` / `<audio>` 发不了 Authorization 头,所以 `POST media-ticket` 发一张
同源 URL 用的短期票据。进程内保存(单 worker),随机 32 字节 urlsafe,30 分钟内可多次使用,全站 ≤ 1000 张,
满了淘汰最老的;重启即失效。参数名是 `ticket`,`core/logging_setup` 对 uvicorn 访问日志的 `ticket=` 脱敏直接生效。
票据值永远不进日志、错误与测试快照。"""
import secrets
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

from app.library.limits import TICKET_MAX, TICKET_TTL_SECONDS


@dataclass(frozen=True)
class _Ticket:
    user_id: int
    item_id: str
    expires_at: float


class MediaTicketStore:
    def __init__(self, ttl_seconds: int = TICKET_TTL_SECONDS, capacity: int = TICKET_MAX,
                 clock: Callable[[], float] = time.monotonic):
        self.ttl = ttl_seconds
        self.capacity = capacity
        self._clock = clock
        self._items: OrderedDict[str, _Ticket] = OrderedDict()

    def __len__(self) -> int:
        return len(self._items)

    def _prune(self) -> None:
        now = self._clock()
        for token in [t for t, v in self._items.items() if v.expires_at <= now]:
            del self._items[token]

    def issue(self, user_id: int, item_id: str) -> str:
        self._prune()
        while len(self._items) >= self.capacity:
            self._items.popitem(last=False)
        token = secrets.token_urlsafe(32)
        self._items[token] = _Ticket(user_id, item_id, self._clock() + self.ttl)
        return token

    def resolve(self, token: str | None, item_id: str) -> int | None:
        """The user id behind a live ticket for this item, else None (wrong item, expired, unknown)."""
        if not token or len(token) > 128:
            return None
        ticket = self._items.get(token)
        if ticket is None:
            return None
        if ticket.expires_at <= self._clock():
            del self._items[token]
            return None
        return ticket.user_id if secrets.compare_digest(ticket.item_id, item_id) else None

    def revoke_item(self, item_id: str) -> int:
        tokens = [t for t, v in self._items.items() if v.item_id == item_id]
        for token in tokens:
            del self._items[token]
        return len(tokens)
