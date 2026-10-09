import asyncio

from app.rooms.hub import Conn, RoomHub
from app.rooms.tickets import RoomTicketStore


class FakeSender:
    def __init__(self, fail=False):
        self.sent, self.closed, self.fail = [], None, fail

    async def send_json(self, data):
        if self.fail:
            raise RuntimeError("gone")
        self.sent.append(data)

    async def close(self, code):
        self.closed = code


async def test_attach_limits_and_broadcast_filters():
    hub = RoomHub(connections_per_user=2)
    a1, a2, a3, b = Conn(1, FakeSender()), Conn(1, FakeSender()), Conn(1, FakeSender()), Conn(2, FakeSender())
    assert hub.attach("r", a1) and hub.attach("r", a2) and not hub.attach("r", a3) and hub.attach("r", b)
    await hub.broadcast("r", {"type": "pong"})
    await hub.broadcast("r", {"type": "assist_reply"}, only_user=1)
    assert [e["type"] for e in a1.sender.sent] == ["pong", "assist_reply"]
    assert [e["type"] for e in b.sender.sent] == ["pong"]
    assert hub.online("r") == {1, 2} and hub.active_rooms() == {"r"}


async def test_failing_sender_is_dropped_and_close_paths():
    hub = RoomHub()
    bad, good = Conn(1, FakeSender(fail=True)), Conn(2, FakeSender())
    hub.attach("r", bad)
    hub.attach("r", good)
    await hub.broadcast("r", {"type": "pong"})
    assert hub.online("r") == {2}
    await hub.close_user("r", 2, 4010)
    assert good.sender.closed == 4010 and hub.active_rooms() == set()
    c = Conn(3, FakeSender())
    hub.attach("x", c)
    await hub.close_all(1012)
    assert c.sender.closed == 1012


class StuckSender(FakeSender):
    """A client that keeps the socket open but never reads: send blocks forever (full write buffer)."""

    async def send_json(self, data):
        await asyncio.Event().wait()


async def test_non_reading_member_is_dropped_without_stalling_the_room():
    """Review #6: one stuck socket must not block every sender's broadcast."""
    hub = RoomHub(send_timeout=0.05)
    stuck, good = Conn(1, StuckSender()), Conn(2, FakeSender())
    hub.attach("r", stuck)
    hub.attach("r", good)
    await asyncio.wait_for(hub.broadcast("r", {"type": "pong"}), 1)
    assert good.sender.sent == [{"type": "pong"}] and hub.online("r") == {2} and stuck.dropped
    await asyncio.wait_for(hub.broadcast("r", {"type": "pong"}), 1)
    await hub.drain()
    assert stuck.sender.closed == 1000 and len(good.sender.sent) == 2


async def test_spawn_drain_and_ai_queue():
    hub = RoomHub()
    done = []

    async def job():
        await asyncio.sleep(0)
        done.append(1)

    hub.spawn(job())
    await hub.drain()
    assert done == [1] and hub.tasks == set()
    hub.ai_enter("r")
    hub.ai_enter("r")
    hub.ai_leave("r")
    assert hub.ai_pending("r") == 1
    blocker = hub.spawn(asyncio.sleep(10))
    await hub.cancel_tasks()
    assert blocker.cancelled()


async def test_forget_clears_memory_of_rooms_without_connections():
    hub = RoomHub()
    hub.lock("gone")
    hub.ai_lock("gone")
    hub.ai_enter("gone")
    live = Conn(1, FakeSender())
    hub.attach("live", live)
    hub.lock("live")
    hub.forget("gone")
    hub.forget("live")  # still connected: kept
    assert hub.ai_pending("gone") == 0 and "gone" not in hub._locks and "live" in hub._locks


def test_tickets_are_one_time_and_expire():
    now = [100.0]
    store = RoomTicketStore(60, clock=lambda: now[0], max_per_user=2)
    t = store.issue(1, "room")
    assert store.redeem(t).room_id == "room" and store.redeem(t) is None
    t2 = store.issue(1, "room")
    now[0] += 61
    assert store.redeem(t2) is None
    first, second, third = store.issue(1, "a"), store.issue(1, "b"), store.issue(1, "c")
    assert store.redeem(first) is None and store.redeem(third).room_id == "c"
