import asyncio
import logging

from app.storage.local import LocalStore
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
                     storage=lambda: LocalStore(tmp_path), store_format=lambda: "mp3", available=lambda: True, llm_available=lambda: True,
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


async def test_translate_once_for_everyone(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
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
    assert "room voice translated" in caplog.text and "面馆" not in caplog.text and "noodle" not in caplog.text


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


async def test_staging_cleanup_after_the_room_closed_ends_retries(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    service, room, hub, senders, state, data_dir = env
    state["fail"] = True
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    await service.deps.store.close(room.id, "owner", NOW)
    assert await service.cleanup_staging(NOW + timedelta(days=1)) == 0
    assert await service.cleanup_staging(NOW + timedelta(days=8)) == 1
    assert not (data_dir / f"room_audio/_staging/{out['id']}.wav").exists()
    assert (data_dir / f"room_audio/{room.id}/{out['id']}.mp3").exists()  # the clip itself is kept forever
    assert "staging cleaned files=1" in caplog.text and "_staging" not in caplog.text  # no paths in logs
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


async def test_hidden_while_pending_never_broadcasts_text(env):
    """Review m1: an admin hides a clip while its transcription (or translation) is in flight."""
    service, room, hub, senders, state, _ = env
    gate, entered = asyncio.Event(), asyncio.Event()
    real = service.deps.transcribe

    async def slow(wav, sender_id):
        entered.set()  # no DB session is open while the upstream runs (the test DB is one shared connection)
        await gate.wait()
        return await real(wav, sender_id)

    service.deps.transcribe = slow
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await entered.wait()
    await service.deps.store.hide(room.id, out["id"], NOW)
    gate.set()
    await hub.drain()
    for uid in (A, B):
        for e in events(senders[uid], "voice_update"):
            assert e["voice"] is None or not e["voice"].get("transcript")
    # translation that finishes after the hide
    service.deps.transcribe = real
    other = await service.upload(room, A, "alice", wav_bytes(2), "c2", None)
    await hub.drain()
    done = asyncio.Event()
    release = asyncio.Event()
    real_complete = service.deps.complete

    async def slow_complete(messages, max_tokens, temperature):
        done.set()
        await release.wait()
        return await real_complete(messages, max_tokens, temperature)

    service.deps.complete = slow_complete
    before = len(events(senders[B], "voice_update"))
    await service.on_translate(FakeConn(hub, room.id, B), other["seq"])
    await done.wait()
    await service.deps.store.hide(room.id, other["id"], NOW)
    release.set()
    await hub.drain()
    for e in events(senders[B], "voice_update")[before:]:
        assert e["voice"] is None or not e["voice"].get("translation")


async def test_retry_spam_by_non_senders_is_rate_limited(env):
    """Review m7: the limiter runs before the DB lookup, for everyone."""
    service, room, hub, senders, state, _ = env
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    service.deps.retry_limiter = RateLimiter(1, 60)
    bob = FakeConn(hub, room.id, B)
    await service.on_retry(bob, out["seq"])
    assert bob.sent[-1] == {"type": "error", "code": "bad_seq"}
    await service.on_retry(bob, out["seq"])
    assert bob.sent[-1] == {"type": "error", "code": "rate_limited"}


async def test_parallel_uploads_cannot_overrun_the_daily_megabytes(env):
    """Review m8: the quota check and the insert are atomic per sender."""
    from app.rooms import audio

    service, room, hub, senders, state, _ = env
    wav = wav_bytes(3)
    info = audio.inspect_wav(wav, min_ms=500, max_ms=60_000)
    size = len(audio.stored_audio(info.pcm, "mp3")[0])
    state["quota_mb"] = 1
    await service.deps.voices.append_voice(room.id, sender_id=A, client_id="old", reply_to=None, quote=None,
                                           duration_ms=1000, audio_path="room_audio/x/old.mp3",
                                           audio_bytes=1_048_576 - size - size // 2, audio_format="mp3",
                                           staging_path=None, now=NOW)
    results = await asyncio.gather(*(service.upload(room, A, "alice", wav, f"p{i}", None) for i in range(3)),
                                   return_exceptions=True)
    await hub.drain()
    ok = [r for r in results if isinstance(r, dict)]
    assert len(ok) == 1
    assert all(isinstance(r, VoiceError) and r.code == "quota" for r in results if not isinstance(r, dict))
    assert await service.deps.voices.used_bytes(A) <= 1_048_576


async def test_stored_wav_is_canonical_without_extra_chunks(env):
    """Review m6: unknown RIFF chunks and trailing bytes of the upload are never stored."""
    import struct

    service, room, hub, senders, state, data_dir = env
    service.deps.store_format = lambda: "wav"
    clean = wav_bytes(1)
    junk = b"LIST" + struct.pack("<I", 16) + b"INFOsecret-junk!"
    riff = bytearray(clean[:12] + junk + clean[12:] + b"TRAILING-PAYLOAD")
    riff[4:8] = struct.pack("<I", len(riff) - 8)
    out = await service.upload(room, A, "alice", bytes(riff), "c1", None)
    stored = (data_dir / f"room_audio/{room.id}/{out['id']}.wav").read_bytes()
    assert b"secret-junk" not in stored and b"TRAILING" not in stored
    assert stored == clean
    assert (await service.deps.voices.get(out["id"])).audio_bytes == len(clean)
    await hub.drain()


class FakeLane:
    """Stands in for AgentLane: records what the voice service hands over (ids and the status, never text)."""

    def __init__(self):
        self.calls: list[tuple[str, str, str]] = []
        self.fail = False

    async def on_voice(self, room_id, message_id, status):
        self.calls.append((room_id, message_id, status))
        if self.fail:
            raise RuntimeError("SECRET-HOOK-FAIL")


async def test_upload_stores_the_target_and_the_quote_in_the_message_meta(env):
    service, room, hub, senders, state, _ = env
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None, "builtin:coach")
    await hub.drain()
    assert out["meta"] == {"to_agent": "builtin:coach"}
    quoted = await service.upload(room, A, "alice", wav_bytes(2), "c2", out["seq"], "builtin:coach")
    assert set(quoted["meta"]) == {"quote", "to_agent"}
    plain = await service.upload(room, A, "alice", wav_bytes(2), "c3", None)
    await hub.drain()
    assert plain["meta"] is None


async def test_every_finished_transcription_reaches_the_agents_hook(env):
    service, room, hub, senders, state, _ = env
    lane = FakeLane()
    service.deps.agents = lambda: lane
    done = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    state["transcript"] = "  "
    empty = await service.upload(room, A, "alice", wav_bytes(2), "c2", None)
    await hub.drain()
    state["transcript"], state["fail"] = "again", True
    failed = await service.upload(room, A, "alice", wav_bytes(2), "c3", None)
    await hub.drain()
    assert lane.calls == [(room.id, done["id"], "done"), (room.id, empty["id"], "empty"),
                          (room.id, failed["id"], "failed")]
    state["fail"] = False  # the sender retries: a success triggers the hook once more, as "done"
    await service.on_retry(FakeConn(hub, room.id, A), failed["seq"])
    await hub.drain()
    assert lane.calls[-1] == (room.id, failed["id"], "done") and len(lane.calls) == 4


async def test_a_lane_without_on_voice_or_none_means_no_hook(env):
    service, room, hub, senders, state, _ = env
    service.deps.agents = lambda: None
    await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()  # one transcription at a time: the order of the updates is then deterministic
    service.deps.agents = lambda: object()  # a lane from before V2
    await service.upload(room, A, "alice", wav_bytes(2), "c2", None)
    await hub.drain()
    assert [u["voice"]["status"] for u in events(senders[B], "voice_update")][-2:] == ["done", "done"]


async def test_a_failing_hook_never_breaks_the_transcription_and_leaks_nothing(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    service, room, hub, senders, state, _ = env
    lane = FakeLane()
    lane.fail = True
    service.deps.agents = lambda: lane
    await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    assert events(senders[B], "voice_update")[-1]["voice"]["status"] == "done"
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    assert "room voice agent hook failed" in text and "RuntimeError" in text
    assert "SECRET-HOOK-FAIL" not in text and "noodle" not in text
