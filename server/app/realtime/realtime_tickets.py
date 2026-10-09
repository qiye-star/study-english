"""One-time tickets and the call registry for realtime calls (plan R15). In-process state,
single worker only. Tickets are secrets: nothing here ever logs them."""
import secrets
import time
from collections import OrderedDict
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass


@dataclass(frozen=True)
class TicketGrant:
    user_id: int
    conversation_id: str


class TicketStore:
    def __init__(self, ttl_seconds: float, clock: Callable[[], float] = time.monotonic, max_tickets: int = 1000,
                 max_per_user: int = 5):
        self._ttl = ttl_seconds
        self._clock = clock
        self._max = max_tickets
        self._max_per_user = max_per_user
        self._items: OrderedDict[str, tuple[float, TicketGrant]] = OrderedDict()

    def _sweep(self, now: float) -> None:
        for key in [k for k, (expires, _) in self._items.items() if expires <= now]:
            del self._items[key]

    def issue(self, user_id: int, conversation_id: str) -> str:
        """A user holds at most `max_per_user` tickets (their own oldest is evicted first), so one
        account cannot push other users' fresh tickets out of the global `max_tickets` bound."""
        now = self._clock()
        own = [k for k, (_, grant) in self._items.items() if grant.user_id == user_id]  # oldest first
        for key in own[: max(0, len(own) - self._max_per_user + 1)]:
            del self._items[key]
        if len(self._items) >= self._max:
            self._sweep(now)
        while len(self._items) >= self._max:
            self._items.popitem(last=False)
        ticket = secrets.token_urlsafe(32)
        self._items[ticket] = (now + self._ttl, TicketGrant(user_id, conversation_id))
        return ticket

    def redeem(self, ticket: str) -> TicketGrant | None:
        item = self._items.pop(ticket, None)
        if item is None or item[0] <= self._clock():
            return None
        return item[1]

    def revoke_user(self, user_id: int) -> int:
        """Drop every unredeemed ticket of a user (admin disable / token revocation)."""
        keys = [k for k, (_, grant) in self._items.items() if grant.user_id == user_id]
        for key in keys:
            del self._items[key]
        return len(keys)

    def __len__(self) -> int:
        return len(self._items)

    def set_ttl(self, seconds: float) -> None:
        """Hot reload (admin v2 §3.6): only tickets issued from now on get the new lifetime."""
        self._ttl = seconds


class RealtimeRegistry:
    def __init__(self, max_sessions: int):
        self._max = max_sessions
        self._users: set[int] = set()

    @property
    def active_count(self) -> int:
        return len(self._users)

    def acquire(self, user_id: int) -> bool:
        if user_id in self._users or len(self._users) >= self._max:
            return False
        self._users.add(user_id)
        return True

    def release(self, user_id: int) -> None:
        self._users.discard(user_id)

    def set_max(self, n: int) -> None:
        """Hot reload (admin v2 §3.6): affects later `acquire` calls; calls already running are never dropped."""
        self._max = n

    @contextmanager
    def hold(self, user_id: int) -> Iterator[bool]:
        """Yields whether the slot was acquired; an acquired slot is released on every exit path
        (return, exception, cancellation). A refused caller never releases someone else's slot."""
        acquired = self.acquire(user_id)
        try:
            yield acquired
        finally:
            if acquired:
                self.release(user_id)
