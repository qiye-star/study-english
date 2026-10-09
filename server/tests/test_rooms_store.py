import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.models import RoomMessage, User
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomError, RoomStore, message_out

NOW = datetime(2026, 10, 9, 9, 0, tzinfo=timezone.utc)
A, B, C = 11111111, 22222222, 33333333


@pytest.fixture
async def store(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=u, username=n, password_hash="x") for u, n in ((A, "alice"), (B, "bob"), (C, "carol"))])
        await s.commit()
    codes = iter(["482913", "482913", "573920", "684031", "795142"])
    return RoomStore(app.state.sessionmaker, RoomLimits(max_members=2, max_owned=2, max_active=3, retention_days=7),
                     code_gen=lambda: next(codes))


async def test_create_join_and_errors(store):
    room = await store.create(A, "  美食  ", NOW)
    assert (room.code, room.topic, room.status) == ("482913", "美食", "open")
    other = await store.create(A, "", NOW)
    assert other.code == "573920"  # first draw collided with the open room
    with pytest.raises(RoomError) as e:
        await store.create(A, "", NOW)
    assert e.value.code == "too_many"
    assert (await store.join("482913", B, NOW))[1] is True
    assert (await store.join("482913", B, NOW))[1] is False  # already a member
    with pytest.raises(RoomError) as e:
        await store.join("482913", C, NOW)
    assert e.value.code == "full"
    with pytest.raises(RoomError) as e:
        await store.join("999999", C, NOW)
    assert e.value.code == "not_found"
    await store.update(room.id, A, locked=True)
    await store.leave(room.id, B, NOW)
    with pytest.raises(RoomError) as e:
        await store.join("482913", B, NOW)
    assert e.value.code == "locked"


async def test_capacity_is_site_wide(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=u, username=n, password_hash="x") for u, n in ((A, "alice"), (B, "bob"))])
        await s.commit()
    store = RoomStore(app.state.sessionmaker, RoomLimits(max_active=1))
    await store.create(A, "", NOW)
    with pytest.raises(RoomError) as e:
        await store.create(B, "", NOW)
    assert e.value.code == "capacity"


async def test_kick_is_permanent_and_owner_only(store):
    room = await store.create(A, "", NOW)
    await store.join(room.code, B, NOW)
    with pytest.raises(RoomError) as e:
        await store.kick(room.id, B, A, NOW)
    assert e.value.code == "forbidden"
    await store.kick(room.id, A, B, NOW)
    with pytest.raises(RoomError) as e:
        await store.join(room.code, B, NOW)
    assert e.value.code == "kicked"
    with pytest.raises(RoomError):
        await store.membership(room.id, B)


async def test_owner_leaving_hands_over(store):
    room = await store.create(A, "", NOW)
    await store.join(room.code, B, NOW + timedelta(seconds=1))
    assert await store.leave(room.id, A, NOW) == B
    assert [m.role for m in await store.members(room.id)] == ["owner"]
    assert (await store.room(room.id)).owner_id == B


async def test_parallel_creates_and_joins_respect_the_caps(app, monkeypatch):
    """Review #16: count-then-insert let parallel requests all pass the cap check."""
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=u, username=f"u{u}", password_hash="x") for u in (A, B, C, 44444444)])
        await s.commit()
    codes = iter(f"{100000 + i}" for i in range(100))
    store = RoomStore(app.state.sessionmaker, RoomLimits(max_members=2, max_owned=1), code_gen=lambda: next(codes))

    async def run(coro):
        try:
            return await coro
        except RoomError as e:
            return e.code

    created = await asyncio.gather(*(run(store.create(A, "", NOW)) for _ in range(3)))
    assert sorted(map(str, (c if isinstance(c, str) else "ok" for c in created))) == ["ok", "too_many", "too_many"]
    room = next(c for c in created if not isinstance(c, str))
    joined = await asyncio.gather(*(run(store.join(room.code, u, NOW)) for u in (B, C, 44444444)))
    assert sum(1 for j in joined if not isinstance(j, str)) == 1
    assert await store.member_count(room.id) == 2


async def test_owner_leaving_an_empty_room_loses_owner_powers(store):
    """Review #12: the ex-owner is not a member any more; the next joiner inherits the room."""
    room = await store.create(A, "", NOW)
    assert await store.leave(room.id, A, NOW) is None
    for call in (store.update(room.id, A, locked=True), store.kick(room.id, A, B, NOW), store.close_by_owner(room.id, A, NOW)):
        with pytest.raises(RoomError) as e:
            await call
        assert e.value.code == "forbidden"
    await store.join(room.code, B, NOW)
    assert [(m.user_id, m.role) for m in await store.members(room.id)] == [(B, "owner")]
    assert (await store.room(room.id)).owner_id == B
    await store.update(room.id, B, locked=False)
    await store.join(room.code, A, NOW)
    assert {m.user_id: m.role for m in await store.members(room.id)} == {A: "member", B: "owner"}


async def test_seq_replay_filters_private_and_truncates(store):
    room = await store.create(A, "", NOW)
    await store.join(room.code, B, NOW)
    for i in range(3):
        await store.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="text", text=f"p{i}", now=NOW,
                           client_id=f"c{i}")
    await store.append(room.id, lane="private", audience_id=A, sender_kind="ai", sender_id=None, kind="assist_reply",
                       text="secret", now=NOW)
    rows, truncated = await store.replay(room.id, B, 0, 10)
    assert [m.seq for m, _ in rows] == [1, 2, 3] and not truncated
    assert [n for _, n in rows] == ["alice"] * 3
    rows, _ = await store.replay(room.id, A, 0, 10)
    assert [m.seq for m, _ in rows] == [1, 2, 3, 4]
    rows, truncated = await store.replay(room.id, B, 0, 2)
    assert [m.seq for m, _ in rows] == [2, 3] and truncated
    assert (await store.find_client(room.id, A, "c1", NOW - timedelta(minutes=5))).seq == 2
    assert await store.get_assist(rows[0][0].id, A, room.id) is None
    assert message_out(rows[0][0], "alice")["sender"] == {"kind": "user", "id": A, "name": "alice"}
    assert await store.recent_public(room.id, 2) == [("alice", "p1"), ("alice", "p2")]


async def test_close_frees_code_and_sweep_purge(store):
    room = await store.create(A, "t", NOW)
    closed = await store.close(room.id, "owner", NOW)
    assert closed.code is None and closed.last_code == "482913"
    again = await store.create(A, "", NOW)  # code reusable at once
    assert again.code == "482913"
    idle = await store.create(A, "", NOW - timedelta(hours=1))
    assert await store.sweep(NOW, online={again.id}) == [(idle.id, "idle")]
    await store.append(idle.id, lane="public", sender_kind="user", sender_id=A, kind="text", text="x", now=NOW)
    assert await store.purge(NOW + timedelta(days=8)) >= 1
    assert await store.history(idle.id, A, 100, 50) == []


async def test_closed_rooms_stay_readable_by_default(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=A, username="alice", password_hash="x"))
        await s.commit()
    store = RoomStore(app.state.sessionmaker, RoomLimits())
    room = await store.create(A, "", NOW)
    await store.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="text", text="kept", now=NOW)
    await store.close(room.id, "owner", NOW)
    assert await store.purge(NOW + timedelta(days=3650)) == 0
    closed, member = await store.membership(room.id, A)  # history stays readable for members
    assert closed.status == "closed" and member.role == "owner"
    assert [m.text for m, _ in await store.history(room.id, A, 100, 50)] == ["kept"]
    assert [r.id for r, _ in await store.mine(A, NOW + timedelta(days=6))] == [room.id]
    assert await store.mine(A, NOW + timedelta(days=8)) == []  # only the /mine listing window is 7 days


async def test_purge_is_off_by_default(app):
    assert await RoomStore(app.state.sessionmaker, RoomLimits()).purge(NOW + timedelta(days=3650)) == 0


async def test_fail_pending_ai_and_reports(store, app):
    room = await store.create(A, "", NOW)
    m = await store.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="text", text="@ai hi",
                           now=NOW, ai_status="pending")
    assert await store.fail_pending_ai() == 1
    async with app.state.sessionmaker() as s:
        assert (await s.get(RoomMessage, m.id)).ai_status == "failed"
    await store.report(room.id, m.id, A, "spam", NOW)
    await store.report(room.id, m.id, A, "spam", NOW)  # duplicate is ignored
    with pytest.raises(RoomError):
        await store.report(room.id, m.id, A, "nope", NOW)
