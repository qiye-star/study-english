"""Cross-branch checks from the rooms v2 x admin v2 integration (see .integration-report.md)."""
import asyncio
from types import SimpleNamespace

from app.routers import rooms


class _Hub:
    def __init__(self):
        self.calls = []

    async def broadcast(self, room_id, data, *, only_user=None, exclude_user=None):
        self.calls.append((room_id, data, only_user))


class _Store:
    def __init__(self, owner_id):
        self._room = SimpleNamespace(owner_id=owner_id)

    async def room(self, room_id):
        return self._room


def test_owner_only_event_is_dropped_for_an_ownerless_room():
    """0009 lets owner_id be NULL; only_user=None would broadcast join requests to every member."""
    hub = _Hub()
    rt = SimpleNamespace(store=_Store(None), hub=hub)
    asyncio.run(rooms._owner_event(rt, "r", {"type": "join_request"}))
    assert hub.calls == []


def test_owner_only_event_goes_to_the_owner():
    hub = _Hub()
    rt = SimpleNamespace(store=_Store(7), hub=hub)
    asyncio.run(rooms._owner_event(rt, "r", {"type": "join_request"}))
    assert hub.calls == [("r", {"type": "join_request"}, 7)]
