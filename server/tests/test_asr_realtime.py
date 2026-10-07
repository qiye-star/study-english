"""Realtime streaming recognizer (Task 1.6 / R21) against a local fake `bigmodel_async` server.

Behaviour under test follows the Task 0.4 spike (docs/superpowers/plans/2026-10-07-voice-spike-results.md §2).
No network access: every upstream is a `websockets` server on 127.0.0.1.
"""
import asyncio
import gzip
import json
import logging
import pathlib
import struct
import types

import httpx
import pytest
from websockets.asyncio.server import serve
from websockets.datastructures import Headers
from websockets.http11 import Response

from app.asr import AsrError, make_transcriber, realtime_factory, shared_asr_gate
from app.asr_realtime import (
    LAST_CHUNK_BYTES,
    MAX_FRAME_PCM_BYTES,
    VolcStreamRecognizer,
    volc_stream_factory,
)
from app.asr_stream import BREAKER_THRESHOLD, AsrGate
from app.stt import pcm_to_wav
from tests.conftest import make_settings

KEY = "rt-secret-uuid"
CHUNK = b"\x01\x00" * 1600  # 100 ms of 16 kHz PCM16


def response(payload: dict, *, seq: int | None = None, last: bool = False, gz: bool = True) -> bytes:
    body = json.dumps(payload).encode()
    if gz:
        body = gzip.compress(body)
    flags = (0b0001 if seq is not None else 0) | (0b0010 if last else 0)
    seq_bytes = struct.pack(">i", seq) if seq is not None else b""
    return bytes([0x11, (0b1001 << 4) | flags, (0b0001 << 4) | (1 if gz else 0), 0]) + seq_bytes + struct.pack(">I", len(body)) + body


def error(code: int, message: str) -> bytes:
    body = json.dumps({"error": message}).encode()
    return bytes([0x11, 0b1111 << 4, 0b0001 << 4, 0]) + struct.pack(">II", code, len(body)) + body


def result(text, **extra) -> dict:
    return {"result": {"text": text, **extra}}


def request_payload(frame: bytes) -> dict:
    return json.loads(gzip.decompress(frame[8:]))


def audio_of(frame: bytes) -> tuple[bytes, bool]:
    return gzip.decompress(frame[8:]), bool(frame[1] & 0b0010)


class FakeRealtime:
    """Scripted `bigmodel_async`. `script` maps an event to the frames to send back:
    'ack' after the full request, 'audio' after each non-last audio frame (by index),
    'last' after the last-packet frame. A frame value of CLOSE closes the connection."""

    CLOSE = object()
    HANG = object()

    def __init__(self):
        self.reject: int | None = None
        self.headers = None
        self.path = None
        self.frames: list[bytes] = []
        self.ack: list = [response(result(""))]  # async: empty result, no sequence (spike)
        self.on_audio: dict[int, list] = {}
        self.on_last: list = [response(result("hello world"), seq=3, last=True)]
        self.connections = 0
        self.open = 0
        self.closed = asyncio.Event()

    async def process_request(self, connection, request):
        self.headers = request.headers
        self.path = request.path
        if self.reject:
            return Response(self.reject, "Nope", Headers([("Content-Length", "0")]), b"")
        return None

    async def _play(self, ws, frames) -> bool:
        for f in frames:
            if f is self.CLOSE:
                await ws.close()
                return False
            if f is self.HANG:  # never answer; return once the client goes away
                await ws.wait_closed()
                return False
            await ws.send(f)
        return True

    async def handler(self, ws):
        self.connections += 1
        self.open += 1
        try:
            self.frames.append(await ws.recv())
            if not await self._play(ws, self.ack):
                return
            index = 0
            async for raw in ws:
                self.frames.append(raw)
                _, last = audio_of(raw)
                frames = self.on_last if last else self.on_audio.get(index, [])
                index += 1
                if not await self._play(ws, frames):
                    return
                if last:
                    await ws.wait_closed()
                    return
        finally:
            self.open -= 1
            self.closed.set()

    async def wait_all_closed(self):
        for _ in range(200):
            if self.open == 0:
                return
            await asyncio.sleep(0.01)
        raise AssertionError(f"{self.open} upstream connection(s) left open")


@pytest.fixture
async def fake():
    f = FakeRealtime()
    # max_queue=None: a handler that stops reading must still see the client's close frame.
    async with serve(f.handler, "127.0.0.1", 0, process_request=f.process_request, max_queue=None) as server:
        port = server.sockets[0].getsockname()[1]
        f.url = f"ws://127.0.0.1:{port}/api/v3/sauc/bigmodel_async"
        yield f


def rt_settings(url: str, **extra):
    values = dict(
        volcengine_tts_key=KEY,
        asr_realtime_url=url,
        realtime_asr_mode="stream",
        asr_stream_resource_id="volc.bigasr.sauc.duration",
        asr_stream_max_concurrency=3,
    )
    values.update(extra)
    return make_settings(**values)


class Partials:
    def __init__(self):
        self.texts: list[str] = []

    async def __call__(self, text: str) -> None:
        self.texts.append(text)


async def open_recognizer(fake, partials=None, **kw) -> VolcStreamRecognizer:
    settings = kw.pop("settings", None) or rt_settings(fake.url)
    return await volc_stream_factory(settings, kw.pop("uid", "42"), **kw)(partials or Partials())


# ---- happy path ----


async def test_partial_then_final_with_verified_request(fake):
    fake.on_audio = {
        1: [response(result("hello"))],
        2: [response(result("hello"))],  # unchanged → no second callback
        3: [response(result(" hello  world ", utterances=[{"text": "hello world", "definite": True}]))],
    }
    fake.on_last = [response(result("Hello,  world.  Again."), seq=5, last=True)]
    partials = Partials()
    rec = await open_recognizer(fake, partials, uid="7")
    for _ in range(4):
        await rec.send_audio(CHUNK)
    assert await rec.finish() == "Hello, world. Again."
    assert partials.texts == ["hello", "hello world"]

    assert fake.path == "/api/v3/sauc/bigmodel_async"
    assert fake.headers["X-Api-Key"] == KEY
    assert fake.headers["X-Api-Resource-Id"] == "volc.bigasr.sauc.duration"
    assert len(fake.headers["X-Api-Connect-Id"]) == 36
    req = request_payload(fake.frames[0])
    assert req["user"] == {"uid": "7"}
    assert req["audio"] == {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1}
    assert req["request"] == {
        "model_name": "bigmodel",
        "enable_itn": True,
        "enable_punc": True,
        "show_utterances": True,
        "enable_nonstream": True,
        "end_window_size": 800,
    }
    assert "result_type" not in req["request"]

    audio = [audio_of(f) for f in fake.frames[1:]]
    assert audio[:4] == [(CHUNK, False)] * 4
    assert audio[4] == (bytes(LAST_CHUNK_BYTES), True)  # 100 ms of silence carries the last flag
    assert LAST_CHUNK_BYTES == 3200
    assert len(audio) == 5
    await fake.wait_all_closed()


async def test_dedicated_asr_key_wins(fake):
    rec = await open_recognizer(fake, settings=rt_settings(fake.url, volcengine_asr_key="asr-only"))
    await rec.finish()
    assert fake.headers["X-Api-Key"] == "asr-only"


async def test_large_chunks_are_split_and_audio_is_kept_for_a_fallback(fake):
    rec = await open_recognizer(fake)
    big = b"\x02\x00" * (MAX_FRAME_PCM_BYTES // 2 + 10)
    await rec.send_audio(big)
    await rec.send_audio(b"")  # ignored
    assert rec.audio == big
    await rec.finish()
    sent = [audio_of(f) for f in fake.frames[1:-1]]
    assert [len(a) for a, _ in sent] == [MAX_FRAME_PCM_BYTES, 20]
    assert b"".join(a for a, _ in sent) == big


async def test_final_frame_with_negative_sequence_is_final(fake):
    fake.on_last = [response(result("done"), seq=-4)]
    rec = await open_recognizer(fake)
    await rec.send_audio(CHUNK)
    assert await rec.finish() == "done"


async def test_partial_callback_failure_does_not_break_the_stream(fake):
    fake.on_audio = {0: [response(result("hi"))]}

    async def boom(_text):
        raise RuntimeError("ui gone")

    rec = await volc_stream_factory(rt_settings(fake.url), "1")(boom)
    await rec.send_audio(CHUNK)
    assert await rec.finish() == "hello world"


# ---- silence-only: empty transcript, not an error ----


@pytest.mark.parametrize(
    "final",
    [result(""), result("   "), {"result": {}}, {}, result(None), result(42)],
    ids=["empty", "spaces", "no-text", "no-result", "null", "int"],
)
async def test_silence_only_is_an_empty_transcript(fake, final):
    fake.on_last = [response(final, seq=2, last=True)]
    partials = Partials()
    rec = await open_recognizer(fake, partials)
    for _ in range(3):
        await rec.send_audio(bytes(3200))
    assert await rec.finish() == ""
    assert partials.texts == []
    await fake.wait_all_closed()


async def test_finish_without_any_audio_still_sends_the_last_packet(fake):
    fake.on_last = [response(result(""), seq=1, last=True)]
    rec = await open_recognizer(fake)
    assert await rec.finish() == ""
    assert [audio_of(f) for f in fake.frames[1:]] == [(bytes(LAST_CHUNK_BYTES), True)]


# ---- upstream errors ----


async def test_quota_error_on_the_request_fails_the_factory(fake):
    fake.ack = [error(45000292, "quota exceeded for types: concurrency"), FakeRealtime.CLOSE]
    gate = AsrGate(3)
    with pytest.raises(AsrError) as e:
        await open_recognizer(fake, gate=gate)
    assert e.value.kind == "upstream"
    assert gate._failures == 1  # counted like asr_stream's quota failures
    await fake.wait_all_closed()


async def test_quota_error_mid_stream(fake):
    fake.on_audio = {0: [error(45000292, "quota exceeded"), FakeRealtime.CLOSE]}
    gate = AsrGate(3)
    rec = await open_recognizer(fake, gate=gate)
    await rec.send_audio(CHUNK)
    with pytest.raises(AsrError) as e:
        for _ in range(50):  # the failure surfaces on a later send or on finish
            await rec.send_audio(CHUNK)
            await asyncio.sleep(0.01)
        await rec.finish()
    assert e.value.kind == "upstream"
    with pytest.raises(AsrError):
        await rec.finish()
    await rec.abort()
    assert gate._failures == 1
    await fake.wait_all_closed()


async def test_quota_message_without_the_code_counts_as_quota(fake):
    fake.ack = [error(45000999, "Quota exhausted"), FakeRealtime.CLOSE]
    gate = AsrGate(3)
    with pytest.raises(AsrError):
        await open_recognizer(fake, gate=gate)
    assert gate._failures == 1


async def test_other_error_frame_is_upstream_and_not_a_breaker_failure(fake):
    fake.on_last = [error(45000001, "invalid params"), FakeRealtime.CLOSE]
    gate = AsrGate(3)
    rec = await open_recognizer(fake, gate=gate)
    with pytest.raises(AsrError) as e:
        await rec.finish()
    assert e.value.kind == "upstream"
    assert gate._failures == 0


@pytest.mark.parametrize("status,kind", [(401, "auth"), (403, "auth"), (500, "upstream")])
async def test_handshake_rejection(fake, status, kind):
    fake.reject = status
    gate = AsrGate(3)
    with pytest.raises(AsrError) as e:
        await open_recognizer(fake, gate=gate)
    assert e.value.kind == kind
    assert gate._failures == (1 if kind == "auth" else 0)
    assert await gate.try_enter() is None  # slot released


async def test_connection_refused_is_upstream():
    server = await asyncio.start_server(lambda r, w: w.close(), "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        with pytest.raises(AsrError) as e:
            await volc_stream_factory(rt_settings(f"ws://127.0.0.1:{port}/x"), "1")(Partials())
    finally:
        server.close()
    assert e.value.kind == "upstream"


async def test_missing_key_is_config_without_connecting(fake):
    with pytest.raises(AsrError) as e:
        await open_recognizer(fake, settings=rt_settings(fake.url, volcengine_tts_key=""))
    assert e.value.kind == "config"
    assert fake.connections == 0


async def test_server_closes_mid_stream(fake):
    fake.on_audio = {0: [FakeRealtime.CLOSE]}
    rec = await open_recognizer(fake)
    await rec.send_audio(CHUNK)
    with pytest.raises(AsrError) as e:
        for _ in range(50):
            await rec.send_audio(CHUNK)
            await asyncio.sleep(0.01)
        await rec.finish()
    assert e.value.kind == "upstream"
    await fake.wait_all_closed()


async def test_server_closes_instead_of_final(fake):
    fake.on_last = [FakeRealtime.CLOSE]
    rec = await open_recognizer(fake)
    await rec.send_audio(CHUNK)
    with pytest.raises(AsrError) as e:
        await rec.finish()
    assert e.value.kind == "upstream"


@pytest.mark.parametrize(
    "bad",
    [
        b"\x11\x91\x10\x00garbage",
        b"\x11",
        "a text frame",
        bytes([0x11, 0x91, 0x11, 0]) + struct.pack(">iI", 1, 3) + b"abc",
        response({"pad": "0" * (5 * 1024 * 1024)}, seq=2),  # inflates past the cap
    ],
    ids=["garbage", "short", "text", "bad-gzip", "gzip-bomb"],
)
async def test_malformed_frames_are_upstream_errors(fake, bad):
    fake.on_audio = {0: [bad]}
    rec = await open_recognizer(fake)
    await rec.send_audio(CHUNK)
    with pytest.raises(AsrError) as e:
        for _ in range(50):
            await rec.send_audio(CHUNK)
            await asyncio.sleep(0.01)
        await rec.finish()
    assert e.value.kind == "upstream"
    await fake.wait_all_closed()


async def test_malformed_ack_fails_the_factory(fake):
    fake.ack = [b"\x11\x91\x10\x00garbage"]
    with pytest.raises(AsrError) as e:
        await open_recognizer(fake)
    assert e.value.kind == "upstream"
    await fake.wait_all_closed()


# ---- timeouts ----


async def test_missing_ack_times_out_at_factory_time(fake):
    fake.ack = [FakeRealtime.HANG]
    gate = AsrGate(1)
    with pytest.raises(AsrError) as e:
        await open_recognizer(fake, gate=gate, open_timeout=0.2)
    assert e.value.kind == "upstream"
    assert await gate.try_enter() is None
    await fake.wait_all_closed()


async def test_final_timeout(fake):
    fake.on_last = [FakeRealtime.HANG]
    rec = await open_recognizer(fake, final_timeout=0.2)
    await rec.send_audio(CHUNK)
    with pytest.raises(AsrError) as e:
        await rec.finish()
    assert e.value.kind == "upstream"
    await fake.wait_all_closed()


async def test_idle_timeout_closes_a_forgotten_connection(fake):
    gate = AsrGate(1)
    rec = await open_recognizer(fake, gate=gate, idle_timeout=0.2)
    await rec.send_audio(CHUNK)
    await fake.wait_all_closed()  # closed by the watchdog, without finish/abort
    assert await gate.try_enter() is None  # and the slot is free again
    gate.leave(None)
    with pytest.raises(AsrError) as e:
        await rec.send_audio(CHUNK)
    assert e.value.kind == "upstream"
    with pytest.raises(AsrError):
        await rec.finish()


async def test_audio_keeps_the_connection_alive(fake):
    rec = await open_recognizer(fake, idle_timeout=0.3)
    for _ in range(6):
        await rec.send_audio(CHUNK)
        await asyncio.sleep(0.1)
    assert await rec.finish() == "hello world"


# ---- cancellation and cleanup ----


def other_tasks(before: set) -> set:
    """Pending tasks started by the client code (the fake server's own tasks are ignored)."""
    return {
        t
        for t in asyncio.all_tasks()
        if t not in before and not t.done() and "VolcStreamRecognizer" in getattr(t.get_coro(), "__qualname__", "")
    }


async def test_cancelled_finish_closes_the_connection_and_leaks_no_task(fake):
    before = set(asyncio.all_tasks())
    fake.on_last = [FakeRealtime.HANG]
    gate = AsrGate(1)
    rec = await open_recognizer(fake, gate=gate)
    await rec.send_audio(CHUNK)
    task = asyncio.create_task(rec.finish())
    await asyncio.sleep(0.1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await fake.wait_all_closed()
    await asyncio.sleep(0)
    assert not other_tasks(before)
    assert await gate.try_enter() is None


async def test_cancelled_factory_releases_everything(fake):
    before = set(asyncio.all_tasks())
    fake.ack = [FakeRealtime.HANG]
    gate = AsrGate(1)
    task = asyncio.create_task(open_recognizer(fake, gate=gate))
    for _ in range(100):
        if fake.open:
            break
        await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await fake.wait_all_closed()
    assert not other_tasks(before)
    assert await gate.try_enter() is None


async def test_abort_is_idempotent_and_closes(fake):
    before = set(asyncio.all_tasks())
    gate = AsrGate(1)
    rec = await open_recognizer(fake, gate=gate)
    await rec.send_audio(CHUNK)
    await rec.abort()
    await rec.abort()
    await fake.wait_all_closed()
    assert not other_tasks(before)
    assert await gate.try_enter() is None
    gate.leave(None)
    with pytest.raises(AsrError):
        await rec.send_audio(CHUNK)
    with pytest.raises(AsrError):
        await rec.finish()


async def test_successful_finish_leaks_nothing(fake):
    before = set(asyncio.all_tasks())
    rec = await open_recognizer(fake)
    await rec.send_audio(CHUNK)
    await rec.finish()
    await rec.abort()  # harmless afterwards
    await fake.wait_all_closed()
    assert not other_tasks(before)


# ---- concurrency gate shared with the upload path ----


async def test_gate_is_shared_with_the_upload_path(fake, monkeypatch):
    settings = rt_settings(fake.url, upstream_asr_mode="volc_stream", asr_stream_max_concurrency=1, upstream_whisper_base_url="")
    state = types.SimpleNamespace()
    gate = shared_asr_gate(state, settings)
    rec = await volc_stream_factory(settings, "1", gate=gate)(Partials())

    # The upload path cannot stream while the call holds the only slot (no fallback → upstream).
    async def must_not_stream(*a, **k):  # pragma: no cover - the gate must skip it
        raise AssertionError("streamed past a full gate")

    monkeypatch.setattr("app.asr.transcribe_pcm", must_not_stream)
    async with httpx.AsyncClient() as http:
        with pytest.raises(AsrError) as e:
            await make_transcriber(http, settings, gate=gate)(pcm_to_wav(CHUNK))
    assert e.value.kind == "upstream"
    # Nor can a second realtime utterance; it fails before connecting.
    with pytest.raises(AsrError) as e:
        await volc_stream_factory(settings, "2", gate=gate)(Partials())
    assert e.value.kind == "upstream"
    assert fake.connections == 1

    await rec.finish()
    assert await gate.try_enter() is None
    gate.leave(None)


async def test_realtime_quota_failures_trip_the_shared_breaker(fake):
    fake.ack = [error(45000292, "quota exceeded"), FakeRealtime.CLOSE]
    settings = rt_settings(fake.url)
    gate = shared_asr_gate(types.SimpleNamespace(), settings)
    for _ in range(BREAKER_THRESHOLD):
        with pytest.raises(AsrError):
            await volc_stream_factory(settings, "1", gate=gate)(Partials())
    assert await gate.try_enter() == "breaker"  # the upload path is skipped too
    with pytest.raises(AsrError) as e:
        await volc_stream_factory(settings, "1", gate=gate)(Partials())
    assert e.value.kind == "upstream"
    assert fake.connections == BREAKER_THRESHOLD


async def test_success_resets_the_breaker_count(fake):
    gate = AsrGate(3)
    gate._failures = 2
    rec = await open_recognizer(fake, gate=gate)
    await rec.finish()
    assert gate._failures == 0


async def test_injects_into_realtime_factory(fake):
    settings = rt_settings(fake.url)
    async with httpx.AsyncClient() as http:
        factory = realtime_factory(http, settings, stream_factory=volc_stream_factory(settings, "1"))
    rec = await factory(Partials())
    assert await rec.finish() == "hello world"


def test_import_direction():
    import app.asr

    source = pathlib.Path(app.asr.__file__).read_text(encoding="utf-8")
    assert "asr_realtime" not in source


# ---- logging ----


async def test_logs_carry_no_text_or_key_and_the_websockets_logger_is_pinned(fake, caplog):
    caplog.set_level(logging.DEBUG)
    fake.on_audio = {0: [response(result("secret words"))]}
    fake.on_last = [response(result("secret words final"), seq=3, last=True)]
    rec = await open_recognizer(fake)
    await rec.send_audio(CHUNK)
    await rec.finish()
    fake.on_last = [error(45000292, "quota exceeded"), FakeRealtime.CLOSE]
    rec = await open_recognizer(fake)
    with pytest.raises(AsrError):
        await rec.finish()

    client = [r for r in caplog.records if not r.name.startswith("websockets.server")]
    assert any(r.name == "app.asr_realtime" for r in client)  # we do log outcomes
    for r in client:
        msg = r.getMessage()
        assert KEY not in msg and "secret words" not in msg
    assert not any(r.name.startswith("websockets.client") for r in client)
    assert not any(r.name == "app.asr_realtime.websockets" and r.levelno < logging.INFO for r in client)
    assert logging.getLogger("app.asr_realtime.websockets").level == logging.INFO
