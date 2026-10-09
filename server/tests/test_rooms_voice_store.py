from datetime import datetime, timedelta, timezone

from app.models import User
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomStore
from app.rooms.voice_store import VoiceStore

NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)
A = 11111111


async def _setup(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=A, username="alice", password_hash="x"))
        await s.commit()
    store = RoomStore(app.state.sessionmaker, RoomLimits())
    room = await store.create(A, "", NOW)
    return store, VoiceStore(app.state.sessionmaker), room


async def _voice(voices, room, cid="c1", now=NOW, reply_to=None, quote=None):
    return await voices.append_voice(room.id, sender_id=A, client_id=cid, reply_to=reply_to, quote=quote,
                                     duration_ms=6400, audio_path=f"room_audio/{room.id}/{cid}.mp3",
                                     audio_bytes=19_200, audio_format="mp3",
                                     staging_path=f"room_audio/_staging/{cid}.wav", now=now)


async def test_append_shares_the_room_seq_and_transcript_lifecycle(app):
    store, voices, room = await _setup(app)
    text = await store.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="text", text="hi",
                              now=NOW)
    msg, voice = await _voice(voices, room)
    assert (msg.seq, msg.kind, msg.text, voice.status) == (text.seq + 1, "voice", "", "pending")
    after = await store.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="text", text="ok",
                               now=NOW)
    assert after.seq == msg.seq + 1  # RoomStore.append and append_voice share one gapless counter (P2-9)
    assert await voices.begin_attempt(msg.id, 3) is True
    v = await voices.set_transcript(msg.id, status="done", transcript="I like noodles.", lang="en", now=NOW)
    assert v.staging_path is None and (await store.out_one(msg.id))["text"] == "I like noodles."
    assert (await store.out_one(msg.id))["voice"]["status"] == "done"
    assert await voices.begin_translation(msg.id, 3) is True
    await voices.undo_translation(msg.id)  # e.g. the daily translate cap: the claim is given back
    v = await voices.get(msg.id)
    assert (v.translation_status, v.translation_attempts) == (None, 0)
    assert await voices.begin_translation(msg.id, 3) is True
    assert await voices.begin_translation(msg.id, 3) is False  # already pending
    v = await voices.set_translation(msg.id, status="done", translation="我喜欢面条。")
    assert (v.translation_status, v.translation_attempts) == ("done", 1)
    assert await voices.begin_translation(msg.id, 3) is False  # done: cached
    assert (await voices.by_seq(room.id, msg.seq))[1].message_id == msg.id
    assert await voices.by_seq(room.id, text.seq) is None


async def test_reply_quote_and_long_transcript(app):
    store, voices, room = await _setup(app)
    quote = {"seq": 1, "name": "alice", "kind": "text", "text": "hi"}
    msg, _ = await _voice(voices, room, reply_to=1, quote=quote)
    assert (msg.reply_to, msg.meta) == (1, {"quote": quote})
    v = await voices.set_transcript(msg.id, status="done", transcript="长" * 1200, lang="zh", now=NOW)
    assert len(v.transcript) == 1000 and v.lang == "zh"


async def test_empty_clears_staging_failed_keeps_it(app):
    store, voices, room = await _setup(app)
    msg, _ = await _voice(voices, room)
    await voices.begin_attempt(msg.id, 3)
    v = await voices.set_transcript(msg.id, status="failed", transcript=None, lang=None, now=NOW)
    assert v.staging_path == "room_audio/_staging/c1.wav"
    await voices.begin_attempt(msg.id, 3)
    v = await voices.set_transcript(msg.id, status="empty", transcript=None, lang=None, now=NOW)
    assert v.staging_path is None and (await store.out_one(msg.id))["text"] == ""
    assert await voices.begin_attempt(msg.id, 3) is False  # empty is final


async def test_attempt_limit_quota_and_restart(app):
    store, voices, room = await _setup(app)
    msg, _ = await _voice(voices, room)
    for _ in range(3):
        assert await voices.begin_attempt(msg.id, 3) is True
        await voices.set_transcript(msg.id, status="failed", transcript=None, lang=None, now=NOW)
    assert await voices.begin_attempt(msg.id, 3) is False
    other, _ = await _voice(voices, room, "c2")
    assert await voices.used_bytes(A) == 38_400
    assert await voices.fail_pending() == 1 and (await voices.get(other.id)).status == "failed"


async def test_used_bytes_since_a_day_start(app):
    store, voices, room = await _setup(app)
    await _voice(voices, room, "old", now=NOW - timedelta(days=1))
    await _voice(voices, room, "new")
    assert await voices.used_bytes(A) == 38_400
    assert await voices.used_bytes(A, since=NOW.replace(hour=0)) == 19_200


async def test_stale_staging_only_for_rooms_closed_long_ago(app):
    store, voices, room = await _setup(app)
    msg, _ = await _voice(voices, room)
    assert await voices.stale_staging(NOW) == []
    await store.close(room.id, "owner", NOW)
    assert await voices.stale_staging(NOW) == []
    assert await voices.stale_staging(NOW + timedelta(days=8)) == [(msg.id, "room_audio/_staging/c1.wav")]
    await voices.clear_staging(msg.id)
    assert await voices.stale_staging(NOW + timedelta(days=8)) == []
    assert (await voices.get(msg.id)).audio_path is not None  # the stored clip itself is never touched


async def test_audio_ref_and_hidden(app):
    store, voices, room = await _setup(app)
    msg, _ = await _voice(voices, room)
    assert await voices.audio_ref(room.id, msg.id) == (f"room_audio/{room.id}/c1.mp3", "mp3", False)
    assert await voices.audio_ref("other-room", msg.id) is None
    assert await voices.audio_ref(room.id, "missing") is None
    await store.hide(room.id, msg.id, NOW)
    assert await voices.audio_ref(room.id, msg.id) == (f"room_audio/{room.id}/c1.mp3", "mp3", True)
    assert await voices.by_seq(room.id, msg.seq) is None  # hidden: no translate / retry
