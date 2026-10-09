"""In-process room hub (spec 2026-10-09 §5.7–5.8): connections, per-room locks, AI queue counters and
background tasks. Single worker only; nothing here must survive a restart."""
import asyncio
from collections.abc import Coroutine
from dataclasses import dataclass
from typing import Protocol


class Sender(Protocol):
    async def send_json(self, data: dict) -> None: ...

    async def close(self, code: int) -> None: ...


SEND_TIMEOUT = 5.0
CLOSE_DROPPED = 1000  # app.rooms.protocol.CLOSE_NORMAL: the web client reconnects and replays


class Dropped(RuntimeError):
    """Raised in a dropped connection's own receive loop so its socket task ends."""


@dataclass(eq=False)
class Conn:
    user_id: int
    sender: Sender
    dropped: bool = False


class RoomHub:
    def __init__(self, connections_per_user: int = 3, send_timeout: float = SEND_TIMEOUT):
        self._max = connections_per_user
        self._send_timeout = send_timeout
        self._rooms: dict[str, list[Conn]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._ai_locks: dict[str, asyncio.Lock] = {}
        self._ai_pending: dict[str, int] = {}
        self.assist_inflight: set[int] = set()  # user ids with a private assist call running (any room)
        # Typing/recording activity (spec 2026-10-10 §6.5): never stored, never replayed.
        self.last_activity: dict[tuple[str, int], tuple[str, float]] = {}  # (room, user) -> (state, monotonic)
        self._activity_seen: dict[Conn, float] = {}  # per-connection throttle: last processed frame
        self.tasks: set[asyncio.Task] = set()

    def lock(self, room_id: str) -> asyncio.Lock:
        return self._locks.setdefault(room_id, asyncio.Lock())

    def ai_lock(self, room_id: str) -> asyncio.Lock:
        return self._ai_locks.setdefault(room_id, asyncio.Lock())

    def ai_pending(self, room_id: str) -> int:
        return self._ai_pending.get(room_id, 0)

    def ai_enter(self, room_id: str) -> None:
        self._ai_pending[room_id] = self.ai_pending(room_id) + 1

    def ai_leave(self, room_id: str) -> None:
        left = self.ai_pending(room_id) - 1
        if left > 0:
            self._ai_pending[room_id] = left
        else:
            self._ai_pending.pop(room_id, None)

    def activity_allow(self, conn: Conn, now_mono: float, interval: float) -> bool:
        """At most one typing frame per connection per `interval` seconds; the rest are dropped silently."""
        last = self._activity_seen.get(conn)
        if last is not None and now_mono - last < interval:
            return False
        self._activity_seen[conn] = now_mono
        return True

    def forget(self, room_id: str) -> None:
        """Drop per-room memory (locks, AI counters) of a closed room with no connections left."""
        if room_id in self._rooms:
            return
        for key in [k for k in self.last_activity if k[0] == room_id]:
            del self.last_activity[key]
        lock, ai_lock = self._locks.get(room_id), self._ai_locks.get(room_id)
        if (lock is None or not lock.locked()) and (ai_lock is None or not ai_lock.locked()):
            self._locks.pop(room_id, None)
            self._ai_locks.pop(room_id, None)
            self._ai_pending.pop(room_id, None)

    def attach(self, room_id: str, conn: Conn) -> bool:
        conns = self._rooms.setdefault(room_id, [])
        if sum(1 for c in conns if c.user_id == conn.user_id) >= self._max:
            if not conns:
                del self._rooms[room_id]
            return False
        conns.append(conn)
        return True

    def detach(self, room_id: str, conn: Conn) -> None:
        self._activity_seen.pop(conn, None)
        conns = self._rooms.get(room_id)
        if conns and conn in conns:
            conns.remove(conn)
        if conns is not None and not conns:
            del self._rooms[room_id]

    def online(self, room_id: str) -> set[int]:
        return {c.user_id for c in self._rooms.get(room_id, ())}

    def active_rooms(self) -> set[str]:
        return set(self._rooms)

    async def send(self, room_id: str, conn: Conn, event: dict) -> None:
        """Send with a timeout. A socket that errors or does not drain in time (client stopped reading) is dropped:
        detached now and closed in the background, so it can never stall the room's senders (review #6)."""
        if conn.dropped:
            return
        try:
            await asyncio.wait_for(conn.sender.send_json(event), self._send_timeout)
        except Exception:
            self.drop(room_id, conn)

    def drop(self, room_id: str, conn: Conn) -> None:
        conn.dropped = True
        self.detach(room_id, conn)
        self.spawn(self._close_quietly(conn))

    async def _close_quietly(self, conn: Conn) -> None:
        try:
            await asyncio.wait_for(conn.sender.close(CLOSE_DROPPED), self._send_timeout)
        except Exception:
            pass

    async def broadcast(self, room_id: str, event: dict, *, only_user: int | None = None,
                        exclude_user: int | None = None) -> None:
        targets = [c for c in self._rooms.get(room_id, ())
                   if (only_user is None or c.user_id == only_user) and c.user_id != exclude_user]
        if len(targets) == 1:
            await self.send(room_id, targets[0], event)
        elif targets:
            await asyncio.gather(*(self.send(room_id, c, event) for c in targets))

    async def _close(self, room_id: str, conns: list[Conn], code: int) -> None:
        for conn in conns:
            self.detach(room_id, conn)
            try:
                await conn.sender.close(code)
            except Exception:
                pass

    async def close_user(self, room_id: str, user_id: int, code: int) -> None:
        await self._close(room_id, [c for c in self._rooms.get(room_id, ()) if c.user_id == user_id], code)

    async def close_room(self, room_id: str, code: int) -> None:
        await self._close(room_id, list(self._rooms.get(room_id, ())), code)

    async def close_all(self, code: int) -> None:
        for room_id in list(self._rooms):
            await self.close_room(room_id, code)

    def spawn(self, coro: Coroutine) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    async def drain(self) -> None:
        while self.tasks:
            await asyncio.gather(*list(self.tasks), return_exceptions=True)

    async def cancel_tasks(self) -> None:
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
