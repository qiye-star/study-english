import asyncio
import logging
from datetime import datetime, timedelta, timezone

import pytest

from app.core import metering
from app.core.ratelimit import RateLimiter
from app.models import User
from app.rooms.hub import Conn, RoomHub
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomStore
from app.rooms.voice import VoiceDeps, VoiceError, VoiceService, detect_lang
from app.rooms.voice_store import VoiceStore
from tests.fixtures.audio import wav_bytes
from tests.test_rooms_hub import FakeSender

NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)
A, B = 11111111, 22222222


class FakeConn:
    def __init__(self, hub, room_id, user_id):
        self.hub, self.room_id, self.user_id, self.sent = hub, room_id, user_id, []

    async def reply(self, data):
        self.sent.append(data)

    async def send_self(self, data):
        self.sent.append(data)


@pytest.fixture
async def env(app, tmp_path):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=A, username="alice", password_hash="x"), User(id=B, username="bob", password_hash="x")])
        await s.commit()
    store = RoomStore(app.state.sessionmaker, RoomLimits())
    room = await store.create(A, "", NOW)
    await store.join(room.code, B, NOW)
    hub = RoomHub()
    senders = {A: FakeSender(), B: FakeSender()}
    for uid, sender in senders.items():
        hub.attach(room.id, Conn(uid, sender))
    state = {"transcript": "I tried the new noodle place.", "fail": False, "quota": 99, "refunds": [],
             "translation": "我去了那家新面馆。", "quota_mb": 200, "consumed": [], "scopes": [],
             "translate_fail": False}

    async def transcribe(wav, sender_id):
        state["scopes"].append(("stt", metering.current_feature(), metering.current_user_id()))
        if state["fail"]:
            raise RuntimeError("upstream")
        return state["transcript"]

    async def complete(messages, max_tokens, temperature):
        state["scopes"].append(("llm", metering.current_feature(), metering.current_user_id()))
        if state["translate_fail"]:
            raise RuntimeError("upstream")
        return state["translation"]

    async def consume(scope, subject, limit):
        state["consumed"].append(scope)
        state["quota"] -= 1
        return state["quota"] >= 0

    async def refund(scope, subject):
        state["refunds"].append(scope)

    async def per_user(_uid):
        return state["quota_mb"]

    async def daily(_uid):
        return 100

    async def template(_key):
        return None

    deps = VoiceDeps(store=store, voices=VoiceStore(app.state.sessionmaker), hub=hub, limits=RoomLimits,
                     data_dir=tmp_path, store_format=lambda: "mp3", available=lambda: True, llm_available=lambda: True,
                     transcribe=transcribe, complete=complete, consume=consume, refund=refund, quota_mb_for=per_user,
                     daily_for=daily, template=template, clock=lambda: NOW, gate=asyncio.Semaphore(2),
                     upload_limiter=RateLimiter(6, 60), translate_limiter=RateLimiter(20, 60),
                     retry_limiter=RateLimiter(6, 60))
    return VoiceService(deps), room, hub, senders, state, tmp_path


def events(sender, type_):
    return [e for e in sender.sent if e["type"] == type_]


async def test_upload_transcribes_once_and_shares_the_result(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    service, room, hub, senders, state, data_dir = env
    out = await service.upload(room, A, "alice", wav_bytes(3), "c1", None)
    assert out["kind"] == "voice" and out["voice"]["status"] == "pending" and out["voice"]["duration_ms"] == 3000
    assert events(senders[B], "message")[-1]["message"]["id"] == out["id"]
    await hub.drain()
    for uid in (A, B):
        update = events(senders[uid], "voice_update")[-1]
        assert update["seq"] == out["seq"]
        assert update["voice"]["status"] == "done" and update["voice"]["lang"] == "en"
    assert (data_dir / f"room_audio/{room.id}/{out['id']}.mp3").exists()
    assert not (data_dir / f"room_audio/_staging/{out['id']}.wav").exists()
    again = await service.upload(room, A, "alice", wav_bytes(3), "c1", None)
    assert again["id"] == out["id"]  # same client_id within 5 minutes
    assert state["consumed"] == ["room_voice", "room_voice_global"]  # the duplicate costs nothing
    assert state["scopes"] == [("stt", "rooms_voice", A)]  # metered as the sender, feature rooms_voice
    assert "noodle" not in caplog.text
    assert "room voice transcribed" in caplog.text


async def test_empty_transcript_is_final_and_not_a_failure(env):
    service, room, hub, senders, state, data_dir = env
    state["transcript"] = "  "
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    assert events(senders[B], "voice_update")[-1]["voice"]["status"] == "empty"
    assert not (data_dir / f"room_audio/_staging/{out['id']}.wav").exists()
    assert state["refunds"] == []


async def test_translate_once_for_everyone(env):
    service, room, hub, senders, state, _ = env
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    bob = FakeConn(hub, room.id, B)
    await service.on_translate(bob, out["seq"])
    await service.on_translate(bob, out["seq"])  # second request while pending: ignored
    await hub.drain()
    done = [e for e in events(senders[A], "voice_update") if e["voice"]["translation_status"] == "done"]
    assert len(done) == 1 and done[0]["voice"]["translation"] == "我去了那家新面馆。"
    await service.on_translate(bob, out["seq"])  # cached: only the asker gets it again
    assert bob.sent[-1]["voice"]["translation"] == "我去了那家新面馆。"
    assert state["scopes"][-1] == ("llm", "rooms_voice", B)  # the requester pays
    assert state["consumed"].count("room_translate_global") == 1


async def test_translate_errors(env):
    service, room, hub, senders, state, _ = env
    bob = FakeConn(hub, room.id, B)
    await service.on_translate(bob, 999)
    assert bob.sent[-1] == {"type": "error", "code": "bad_seq"}
    state["fail"] = True
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    await service.on_translate(bob, out["seq"])  # transcript failed: nothing to translate
    assert bob.sent[-1] == {"type": "error", "code": "bad_seq"}
    service.deps.translate_limiter = RateLimiter(0, 60)
    await service.on_translate(bob, out["seq"])
    assert bob.sent[-1] == {"type": "error", "code": "rate_limited"}


async def test_translate_without_llm_is_off(env):
    service, room, hub, senders, state, _ = env
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    service.deps.llm_available = lambda: False
    bob = FakeConn(hub, room.id, B)
    await service.on_translate(bob, out["seq"])
    assert bob.sent[-1] == {"type": "notice", "code": "voice_off"}


async def test_translate_daily_cap_and_upstream_failure(env):
    service, room, hub, senders, state, _ = env
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    bob = FakeConn(hub, room.id, B)
    state["quota"] = 0
    await service.on_translate(bob, out["seq"])
    assert bob.sent[-1] == {"type": "notice", "code": "translate_quota"}
    state["quota"] = 99
    state["translate_fail"] = True
    await service.on_translate(bob, out["seq"])  # the cap gave the claim back: this one runs
    await hub.drain()
    assert events(senders[A], "voice_update")[-1]["voice"]["translation_status"] == "failed"
    assert "room_translate_global" in state["refunds"]
    state["translate_fail"] = False
    await service.on_translate(bob, out["seq"])  # failed translations can be asked for again
    await hub.drain()
    assert events(senders[A], "voice_update")[-1]["voice"]["translation_status"] == "done"


async def test_failed_transcription_can_be_retried_by_the_sender_only(env):
    service, room, hub, senders, state, data_dir = env
    state["fail"] = True
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    assert events(senders[B], "voice_update")[-1]["voice"]["status"] == "failed"
    assert (data_dir / f"room_audio/_staging/{out['id']}.wav").exists()
    assert state["refunds"] == ["room_voice_global"]  # upstream failure gives the global count back
    bob = FakeConn(hub, room.id, B)
    await service.on_retry(bob, out["seq"])
    assert bob.sent[-1] == {"type": "error", "code": "bad_seq"}
    state["fail"] = False
    await service.on_retry(FakeConn(hub, room.id, A), out["seq"])
    await hub.drain()
    assert events(senders[B], "voice_update")[-1]["voice"]["status"] == "done"
    assert events(senders[B], "voice_update")[-1]["voice"]["attempts"] == 2


async def test_retry_limits(env):
    service, room, hub, senders, state, data_dir = env
    state["fail"] = True
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    alice = FakeConn(hub, room.id, A)
    for _ in range(2):
        await service.on_retry(alice, out["seq"])
        await hub.drain()
    await service.on_retry(alice, out["seq"])  # 3 attempts used
    assert alice.sent[-1] == {"type": "notice", "code": "retry_limit"}


async def test_staging_cleanup_after_the_room_closed_ends_retries(env):
    service, room, hub, senders, state, data_dir = env
    state["fail"] = True
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    await service.deps.store.close(room.id, "owner", NOW)
    assert await service.cleanup_staging(NOW + timedelta(days=1)) == 0
    assert await service.cleanup_staging(NOW + timedelta(days=8)) == 1
    assert not (data_dir / f"room_audio/_staging/{out['id']}.wav").exists()
    assert (data_dir / f"room_audio/{room.id}/{out['id']}.mp3").exists()  # the clip itself is kept forever
    alice = FakeConn(hub, room.id, A)
    await service.on_retry(alice, out["seq"])
    assert alice.sent[-1] == {"type": "notice", "code": "retry_limit"}


async def test_resume_fails_interrupted_transcriptions(env):
    service, room, hub, senders, state, _ = env
    service.deps.gate = asyncio.Semaphore(0)  # nothing gets through: the clip stays pending
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await asyncio.sleep(0)
    assert await service.resume() == 1
    assert (await service.deps.voices.get(out["id"])).status == "failed"
    await hub.cancel_tasks()


@pytest.mark.parametrize("change,code", [
    ({"quota_mb": 0}, "quota"),
    ({"quota": 0}, "daily"),
    ({"quota": 1}, "daily"),  # per-user ok, global cap reached: the per-user count is given back
])
async def test_upload_limits(env, change, code):
    service, room, hub, senders, state, data_dir = env
    state.update(change)
    with pytest.raises(VoiceError) as e:
        await service.upload(room, A, "alice", wav_bytes(2), "c9", None)
    assert e.value.code == code
    if change == {"quota": 1}:
        assert state["refunds"] == ["room_voice"]
    assert not any((data_dir / "room_audio").rglob("*.*")) if (data_dir / "room_audio").exists() else True


async def test_storage_quota_counts_today_only(env):
    service, room, hub, senders, state, _ = env
    voices = service.deps.voices
    await voices.append_voice(room.id, sender_id=A, client_id="old", reply_to=None, quote=None, duration_ms=1000,
                              audio_path="room_audio/x/old.mp3", audio_bytes=1_048_576, audio_format="mp3",
                              staging_path=None, now=NOW - timedelta(days=1))
    state["quota_mb"] = 1
    await service.upload(room, A, "alice", wav_bytes(1), "c1", None)  # yesterday's megabyte does not count
    await hub.drain()  # the test DB is one shared in-memory connection: no overlapping sessions
    await voices.append_voice(room.id, sender_id=A, client_id="big", reply_to=None, quote=None, duration_ms=1000,
                              audio_path="room_audio/x/big.mp3", audio_bytes=1_040_000, audio_format="mp3",
                              staging_path=None, now=NOW)
    with pytest.raises(VoiceError) as e:
        await service.upload(room, A, "alice", wav_bytes(5), "c2", None)  # ~15 KB more today: over 1 MB
    assert e.value.code == "quota"


async def test_upload_rate_audio_and_reply_errors(env):
    service, room, hub, senders, state, _ = env
    for audio_, code in ((b"ID3xx", "bad_audio"), (wav_bytes(0.2), "too_short"), (wav_bytes(61), "too_long")):
        with pytest.raises(VoiceError) as e:
            await service.upload(room, A, "alice", audio_, "c-" + code, None)
        assert e.value.code == code
    with pytest.raises(VoiceError) as e:
        await service.upload(room, A, "alice", wav_bytes(1), "c-reply", 999)
    assert e.value.code == "bad_reply"
    service.deps.upload_limiter = RateLimiter(0, 60)
    with pytest.raises(VoiceError) as e:
        await service.upload(room, A, "alice", wav_bytes(1), "c-rate", None)
    assert e.value.code == "rate"
    assert state["consumed"] == []  # nothing was charged for rejected uploads


async def test_reply_stores_the_quote(env):
    service, room, hub, senders, state, _ = env
    first = await service.upload(room, A, "alice", wav_bytes(1), "c1", None)
    await hub.drain()
    out = await service.upload(room, B, "bob", wav_bytes(1), "c2", first["seq"])
    assert out["reply_to"] == first["seq"] and out["quote"]["text"] == "I tried the new noodle place."


async def test_room_without_voice_is_off(env):
    service, room, *_ = env
    room.allow_voice = False
    with pytest.raises(VoiceError) as e:
        await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    assert e.value.code == "off"


async def test_site_switch_off_stops_uploads_and_retries(env):
    service, room, hub, senders, state, _ = env
    state["fail"] = True
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    service.deps.available = lambda: False
    with pytest.raises(VoiceError) as e:
        await service.upload(room, A, "alice", wav_bytes(2), "c2", None)
    assert e.value.code == "off"
    alice = FakeConn(hub, room.id, A)
    await service.on_retry(alice, out["seq"])
    assert alice.sent[-1] == {"type": "notice", "code": "voice_off"}


async def test_wav_store_format(env):
    service, room, hub, senders, state, data_dir = env
    service.deps.store_format = lambda: "wav"
    out = await service.upload(room, A, "alice", wav_bytes(1), "c1", None)
    assert (data_dir / f"room_audio/{room.id}/{out['id']}.wav").exists()
    assert (await service.deps.voices.get(out["id"])).audio_format == "wav"


@pytest.mark.parametrize("text,lang", [("我昨天去了面馆", "zh"), ("I went there yesterday", "en"),
                                       ("I like 巧克力 very much", "en"), ("", "en")])
def test_detect_lang(text, lang):
    assert detect_lang(text) == lang
