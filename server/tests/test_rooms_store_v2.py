from datetime import datetime, timezone

from app.models import RoomJoinRequest, RoomReaction, RoomVoice, User
from app.rooms.rules import LEVELS, RoomLimits
from app.rooms.scenarios import SCENARIOS, brief, scenario
from app.rooms.store import RoomStore, room_out

NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)
A, B = 11111111, 22222222


async def _store(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=A, username="alice", password_hash="x"), User(id=B, username="bob", password_hash="x")])
        await s.commit()
    store = RoomStore(app.state.sessionmaker, RoomLimits())
    room = await store.create(A, "美食", NOW)
    await store.join(room.code, B, NOW)
    return store, room


async def test_message_out_v2_with_voice_quote_and_reactions(app):
    store, room = await _store(app)
    text = await store.append(room.id, lane="public", sender_kind="user", sender_id=B, kind="text", text="Any food?",
                              now=NOW)
    voice = await store.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="voice", text="",
                               now=NOW, reply_to=text.seq,
                               meta={"quote": {"seq": text.seq, "name": "bob", "kind": "text", "text": "Any food?"}})
    async with app.state.sessionmaker() as s:
        s.add(RoomVoice(message_id=voice.id, room_id=room.id, sender_id=A, duration_ms=6400, audio_path="x.mp3",
                        audio_bytes=1, audio_format="mp3", status="pending", created_at=NOW))
        s.add_all([RoomReaction(room_id=room.id, message_id=text.id, seq=text.seq, user_id=u, key="like", created_at=NOW)
                   for u in (A, B)])
        s.add(RoomReaction(room_id=room.id, message_id=text.id, seq=text.seq, user_id=B, key="haha", created_at=NOW))
        await s.commit()
    rows, truncated = await store.replay_out(room.id, A, 0, 50)
    assert truncated is False
    by_kind = {m["kind"]: m for m in rows}
    # keys come out in REACTION_KEYS order, users in the order they reacted
    assert by_kind["text"]["reactions"] == [{"key": "like", "user_ids": [A, B]}, {"key": "haha", "user_ids": [B]}]
    assert by_kind["text"]["voice"] is None and by_kind["text"]["quote"] is None
    v = by_kind["voice"]
    assert v["quote"] == {"seq": text.seq, "name": "bob", "kind": "text", "text": "Any food?"}
    assert v["voice"] == {"duration_ms": 6400, "status": "pending", "transcript": None, "lang": None,
                          "translation": None, "translation_status": None, "attempts": 0, "audio": True}
    assert v["reactions"] == []
    assert await store.recent_reactions(room.id) == [{"seq": text.seq, "key": "like", "user_ids": [A, B]},
                                                      {"seq": text.seq, "key": "haha", "user_ids": [B]}]
    assert await store.recent_reactions(room.id, messages=0) == []
    assert (await store.out_one(voice.id))["voice"]["status"] == "pending"
    assert await store.out_one("missing") is None
    history = await store.history_out(room.id, A, 2_147_483_647, 50)
    assert [m["seq"] for m in history] == [m["seq"] for m in rows]


async def test_hidden_message_withholds_v2_fields_and_clears_quote_snapshots(app):
    store, room = await _store(app)
    m = await store.append(room.id, lane="public", sender_kind="user", sender_id=B, kind="text", text="x", now=NOW,
                           meta={"quote": {"seq": 1, "name": "a", "kind": "text", "text": "y"}})
    quoting = await store.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="text", text="z",
                                 now=NOW, reply_to=m.seq,
                                 meta={"quote": {"seq": m.seq, "name": "bob", "kind": "text", "text": "x"}})
    async with app.state.sessionmaker() as s:
        s.add(RoomReaction(room_id=room.id, message_id=m.id, seq=m.seq, user_id=A, key="wow", created_at=NOW))
        await s.commit()
    await store.hide(room.id, m.id, NOW)
    out = {x["seq"]: x for x in await store.history_out(room.id, A, 2_147_483_647, 50)}
    hidden = out[m.seq]
    assert (hidden["text"], hidden["meta"], hidden["quote"], hidden["voice"], hidden["reactions"], hidden["hidden"]) == (
        "", None, None, None, [], True)
    assert out[quoting.seq]["quote"] == {"seq": m.seq, "name": "bob", "kind": "text", "text": ""}


async def test_room_out_v2_and_pending_requests(app):
    store, room = await _store(app)
    out = room_out(room, my_role="owner", member_count=2, online_count=0)
    assert {k: out[k] for k in ("name", "topic", "scenario", "level", "join_mode", "max_members", "allow_voice")} == {
        "name": "美食", "topic": "美食", "scenario": "free", "level": "A2", "join_mode": "code", "max_members": 4,
        "allow_voice": True}
    async with app.state.sessionmaker() as s:
        s.add(User(id=3, username="carol", password_hash="x"))
        s.add(RoomJoinRequest(id="q1", room_id=room.id, user_id=3, status="pending", created_at=NOW))
        s.add(RoomJoinRequest(id="q2", room_id=room.id, user_id=3, status="denied", created_at=NOW))
        await s.commit()
    assert await store.pending_requests(room.id) == [
        {"id": "q1", "room_id": room.id, "room_name": "美食", "user_id": 3, "name": "carol", "status": "pending",
         "created_at": "2026-10-10T09:00:00+00:00"}]


def test_scenarios_and_levels():
    assert [s.key for s in SCENARIOS] == ["free", "cafe", "interview", "airport", "hotel", "doctor", "renting",
                                          "directions", "smalltalk"]
    assert scenario("cafe").title_zh == "咖啡店点单" and scenario("cafe").title_en == "At a café"
    assert scenario("nope") is None
    assert brief("nope") == brief("free") == "Free conversation; any everyday topic."
    assert LEVELS == ("A1", "A2", "B1", "B2", "C1")
