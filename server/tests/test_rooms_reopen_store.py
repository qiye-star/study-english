import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models import Room, RoomMember, User
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomError, RoomStore, decode_cursor, encode_cursor, opened_anchor, room_out

NOW = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)
A, B, C = 11111111, 22222222, 33333333


def make_store(app, codes, **limits):
    it = iter(codes)
    return RoomStore(app.state.sessionmaker, RoomLimits(max_members=4, **limits), code_gen=lambda: next(it))


@pytest.fixture
async def users(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=u, username=n, password_hash="x") for u, n in ((A, "alice"), (B, "bob"), (C, "carol"))])
        await s.commit()


async def closed_room(store, owner=A, reason="owner", at=NOW):
    room = await store.create(owner, "", at)
    await store.close(room.id, reason, at)
    return room


async def test_create_sets_opened_at_and_sweep_counts_from_it(app, users):
    store = make_store(app, ["482913", "573920"], max_hours=24, idle_minutes=30)
    room = await store.create(A, "", NOW)
    assert room.opened_at == NOW and room.reopen_count == 0
    # keep it "online" so only the age rule can fire
    assert await store.sweep(NOW + timedelta(hours=23), {room.id}) == []
    assert await store.sweep(NOW + timedelta(hours=25), {room.id}) == [(room.id, "expired")]
    # a legacy row (no opened_at) falls back to created_at
    legacy = await store.create(B, "", NOW)
    async with app.state.sessionmaker() as s:
        row = await s.get(Room, legacy.id)
        row.opened_at = None
        await s.commit()
    assert opened_anchor(await store.room(legacy.id)) == NOW
    assert await store.sweep(NOW + timedelta(hours=25), {legacy.id}) == [(legacy.id, "expired")]


async def test_reopen_resets_the_expiry_clock(app, users):
    store = make_store(app, ["482913", "573920"], max_hours=24)
    room = await closed_room(store, reason="expired", at=NOW + timedelta(hours=24))
    reopened = await store.reopen(room.id, A, NOW + timedelta(hours=30))
    assert reopened.opened_at == NOW + timedelta(hours=30)
    # created 31h ago but reopened 1h ago: not expired
    assert await store.sweep(NOW + timedelta(hours=31), {room.id}) == []
    assert await store.sweep(NOW + timedelta(hours=55), {room.id}) == [(room.id, "expired")]


async def test_reopen_state_changes_and_members_stay(app, users):
    store = make_store(app, ["482913", "573920"])
    room = await store.create(A, "", NOW)
    await store.join(room.code, B, NOW)
    await store.join(room.code, C, NOW)
    await store.kick(room.id, A, C, NOW)
    await store.leave(room.id, B, NOW)
    async with app.state.sessionmaker() as s:
        (await s.get(Room, room.id)).invite_token = "tok-secret"
        await s.commit()
    await store.close(room.id, "idle", NOW + timedelta(minutes=40))
    later = NOW + timedelta(days=2)
    reopened = await store.reopen(room.id, A, later)
    assert (reopened.status, reopened.code, reopened.last_code) == ("open", "573920", "573920")
    assert reopened.closed_at is None and reopened.close_reason is None
    assert reopened.opened_at == later and reopened.last_active_at == later and reopened.reopen_count == 1
    assert reopened.invite_token is None  # R-O8: old links do not come back
    async with app.state.sessionmaker() as s:
        rows = {m.user_id: (m.role, m.left_at is not None, m.kicked) for m in
                (await s.scalars(select(RoomMember).where(RoomMember.room_id == room.id))).all()}
    assert rows == {A: ("owner", False, False), B: ("member", True, False), C: ("member", True, True)}
    with pytest.raises(RoomError) as e:
        await store.join("573920", C, later)
    assert e.value.code == "kicked"  # R-O8
    assert (await store.join("573920", B, later))[1] is True  # a member who left may come back with the NEW code


async def test_reopen_permissions_and_conditions(app, users):
    store = make_store(app, ["482913", "573920", "684031"])
    room = await store.create(A, "", NOW)
    await store.join(room.code, B, NOW)
    with pytest.raises(RoomError) as e:
        await store.reopen(room.id, A, NOW)  # still open
    assert e.value.code == "not_closed"
    await store.close(room.id, "owner", NOW)
    with pytest.raises(RoomError) as e:
        await store.reopen(room.id, B, NOW)  # a member is not the owner
    assert e.value.code == "forbidden"
    with pytest.raises(RoomError) as e:
        await store.reopen(room.id, C, NOW)  # a stranger
    assert e.value.code == "forbidden"
    with pytest.raises(RoomError) as e:
        await store.reopen("nope", A, NOW)
    assert e.value.code == "not_found"
    admin_closed = await closed_room(store, reason="admin")
    with pytest.raises(RoomError) as e:
        await store.reopen(admin_closed.id, A, NOW)
    assert e.value.code == "admin_closed"
    assert (await store.reopen(admin_closed.id, None, NOW, admin=True)).status == "open"  # R-O9: the operator may
    async with app.state.sessionmaker() as s:
        ownerless = await s.get(Room, room.id)
        ownerless.owner_id = None
        await s.commit()
    with pytest.raises(RoomError) as e:
        await store.reopen(room.id, None, NOW, admin=True)
    assert e.value.code == "no_owner"


async def test_reopen_respects_max_owned_and_site_capacity(app, users):
    store = make_store(app, [f"{482900 + i}" for i in range(10)], max_owned=1, max_active=2)
    closed = await closed_room(store)
    live = await store.create(A, "", NOW)
    with pytest.raises(RoomError) as e:
        await store.reopen(closed.id, A, NOW)
    assert e.value.code == "too_many"
    assert (await store.reopen(closed.id, A, NOW, max_owned=2)).status == "open"  # the user's own cap (quota override)
    await store.close(live.id, "owner", NOW)
    other = await closed_room(store, owner=B)
    await store.create(C, "", NOW)  # second open room site-wide -> full (A's reopened one + C's)
    with pytest.raises(RoomError) as e:
        await store.reopen(other.id, B, NOW)
    assert e.value.code == "capacity"


async def test_two_parallel_reopens_count_once(app, users):
    store = make_store(app, ["482913", "573920", "684031"])
    room = await closed_room(store)

    async def run():
        try:
            return (await store.reopen(room.id, A, NOW)).reopen_count
        except RoomError as e:
            return e.code

    results = await asyncio.gather(run(), run())
    assert sorted(map(str, results)) == ["1", "not_closed"]
    assert (await store.room(room.id)).reopen_count == 1


async def test_reopen_skips_a_code_that_an_open_room_holds(app, users):
    store = make_store(app, ["482913", "573920", "573920", "684031"])  # A's room: 482913; B's room: 573920
    mine = await closed_room(store)
    await store.create(B, "", NOW)
    reopened = await store.reopen(mine.id, A, NOW)
    assert reopened.code == "684031"  # the 573920 draw collided with B's open room


async def test_mine_lists_only_open_rooms_and_ended_pages_by_end_time(app, users):
    store = make_store(app, [f"{482900 + i}" for i in range(20)], max_owned=10)
    first = await closed_room(store, at=NOW)
    second = await closed_room(store, at=NOW + timedelta(hours=1))
    third = await closed_room(store, at=NOW + timedelta(hours=2))
    live = await store.create(A, "", NOW)
    shared = await store.create(B, "", NOW)
    await store.join(shared.code, A, NOW)
    await store.close(shared.id, "idle", NOW + timedelta(hours=3))
    await store.leave(first.id, A, NOW)  # leaving removes it from my ended list
    assert [r.id for r, _ in await store.mine(A, NOW + timedelta(days=400))] == [live.id]  # no 7-day window any more
    assert await store.ended_count(A) == 3
    page, nxt = await store.ended(A, None, 2)
    assert [r.id for r, _ in page] == [shared.id, third.id] and [role for _, role in page] == ["member", "owner"]
    assert nxt is not None
    page2, nxt2 = await store.ended(A, decode_cursor(encode_cursor(*nxt)), 2)
    assert [r.id for r, _ in page2] == [second.id] and nxt2 is None
    assert await store.ended(C, None, 10) == ([], None)  # strangers see nothing


async def test_ended_includes_old_rooms_and_cursor_rejects_garbage(app, users):
    store = make_store(app, ["482913"])
    old = await closed_room(store, at=NOW - timedelta(days=900))
    assert [r.id for r, _ in (await store.ended(A, None, 5))[0]] == [old.id]
    for bad in ("", "!!!", "bm9wZQ", encode_cursor(NOW, "x")[:-3]):
        with pytest.raises(ValueError):
            decode_cursor(bad)


async def test_room_out_carries_the_close_reason(app, users):
    store = make_store(app, ["482913", "573920"])
    room = await closed_room(store, reason="idle")
    out = room_out(await store.room(room.id), my_role="owner", member_count=1, online_count=0)
    assert out["close_reason"] == "idle" and out["status"] == "closed" and out["code"] is None
    live = room_out(await store.create(B, "", NOW), my_role="owner", member_count=1, online_count=0)
    assert live["close_reason"] is None
