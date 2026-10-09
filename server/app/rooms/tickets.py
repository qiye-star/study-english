"""One-time room tickets (spec 2026-10-09 §5.7, ruling R-5: a small copy of realtime_tickets.TicketStore,
since rooms must not import realtime). Tickets are bearer secrets: never log them."""
import secrets
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class RoomGrant:
    user_id: int
    room_id: str


class RoomTicketStore:
    def __init__(self, ttl_seconds: float, clock: Callable[[], float] = time.monotonic, max_tickets: int = 1000,
                 max_per_user: int = 5):
        self._ttl, self._clock, self._max, self._max_per_user = ttl_seconds, clock, max_tickets, max_per_user
        self._items: OrderedDict[str, tuple[float, RoomGrant]] = OrderedDict()

    def issue(self, user_id: int, room_id: str) -> str:
        now = self._clock()
        own = [k for k, (_, g) in self._items.items() if g.user_id == user_id]
        for key in own[: max(0, len(own) - self._max_per_user + 1)]:
            del self._items[key]
        for key in [k for k, (exp, _) in self._items.items() if exp <= now]:
            del self._items[key]
        while len(self._items) >= self._max:
            self._items.popitem(last=False)
        ticket = secrets.token_urlsafe(32)
        self._items[ticket] = (now + self._ttl, RoomGrant(user_id, room_id))
        return ticket

    def set_ttl(self, seconds: float) -> None:
        """Hot reload: only tickets issued from now on get the new lifetime."""
        self._ttl = seconds

    def revoke_user(self, user_id: int) -> int:
        """Drop every unredeemed ticket of a user (admin disable / token revocation)."""
        keys = [k for k, (_, g) in self._items.items() if g.user_id == user_id]
        for key in keys:
            del self._items[key]
        return len(keys)

    def redeem(self, ticket: str) -> RoomGrant | None:
        item = self._items.pop(ticket, None)
        if item is None or item[0] <= self._clock():
            return None
        return item[1]
