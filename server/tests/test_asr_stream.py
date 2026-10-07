import asyncio
import gzip
import io
import json
import logging
import struct
import wave

import pytest
from websockets.asyncio.server import serve
from websockets.datastructures import Headers
from websockets.http11 import Response

from app.asr_stream import (
    BREAKER_COOLDOWN,
    BREAKER_THRESHOLD,
    CHUNK_BYTES,
    MAX_DECOMPRESSED_BYTES,
    MAX_TIMEOUT,
    AsrGate,
    AsrStreamError,
    decode_frame,
    encode_audio,
    encode_full_request,
    stream_budget,
    transcribe_pcm,
    wav_to_pcm,
)
from app.config import Settings


def make_wav(rate=16000, channels=1, width=2, frames=1600) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(b"\x01\x00" * frames * channels * (width // 2 or 1))
    return buf.getvalue()


def server_response(payload: dict, *, seq: int, last: bool = False, gz: bool = False) -> bytes:
    body = json.dumps(payload).encode()
    if gz:
        body = gzip.compress(body)
    flags = 0b0011 if last else 0b0001
    return (
        bytes([0x11, (0b1001 << 4) | flags, (0b0001 << 4) | (1 if gz else 0), 0])
        + struct.pack(">i", seq)
        + struct.pack(">I", len(body))
        + body
    )


def server_error(code: int, message: str) -> bytes:
    body = json.dumps({"error": message}).encode()
    return bytes([0x11, 0b1111 << 4, 0b0001 << 4, 0]) + struct.pack(">II", code, len(body)) + body


# ---- frame codec ----


def test_full_request_frame_layout():
    frame = encode_full_request({"a": 1})
    assert frame[:4] == bytes([0x11, 0x10, 0x11, 0x00])
    size = struct.unpack(">I", frame[4:8])[0]
    assert size == len(frame) - 8
    assert json.loads(gzip.decompress(frame[8:])) == {"a": 1}


@pytest.mark.parametrize("last,flags", [(False, 0), (True, 2)])
def test_audio_frame_layout(last, flags):
    frame = encode_audio(b"\x01\x02", last)
    assert frame[:4] == bytes([0x11, 0x20 | flags, 0x01, 0x00])
    assert gzip.decompress(frame[8:]) == b"\x01\x02"
    assert struct.unpack(">I", frame[4:8])[0] == len(frame) - 8


@pytest.mark.parametrize("gz", [False, True])
def test_decode_full_response(gz):
    f = decode_frame(server_response({"result": {"text": "hi"}}, seq=7, last=True, gz=gz))
    assert f.msg_type == 0b1001 and f.last and f.sequence == 7
    assert f.payload == {"result": {"text": "hi"}}


def test_decode_negative_sequence_is_last():
    f = decode_frame(server_response({"result": {"text": "x"}}, seq=-3))
    assert f.last


def test_decode_error_frame():
    f = decode_frame(server_error(45000292, "quota exceeded"))
    assert f.msg_type == 0b1111 and f.code == 45000292
    assert f.payload == {"error": "quota exceeded"}


@pytest.mark.parametrize(
    "raw",
    [
        b"",
        b"\x11",
        bytes([0x11, 0x91, 0x10, 0]) + b"\x00\x00",
        bytes([0x11, 0x91, 0x10, 0]) + struct.pack(">iI", 1, 100) + b"{}",
        bytes([0x11, 0x91, 0x11, 0]) + struct.pack(">iI", 1, 3) + b"abc",
        bytes([0x11, 0x91, 0x10, 0]) + struct.pack(">iI", 1, 3) + b"abc",
        bytes([0x11, 0x91, 0x10, 0]) + struct.pack(">iI", 1, 2) + b"[]",
        bytes([0x21, 0x91, 0x10, 0]) + struct.pack(">iI", 1, 2) + b"{}",
        "text frame",
    ],
)
def test_decode_rejects_malformed(raw):
    with pytest.raises(AsrStreamError) as e:
        decode_frame(raw)
    assert e.value.kind == "protocol"


# ---- WAV ----


def test_wav_to_pcm_accepts_16k_mono_16bit():
    pcm = wav_to_pcm(make_wav(frames=1600))
    assert pcm is not None and len(pcm) == 3200


@pytest.mark.parametrize(
    "data",
    [
        make_wav(rate=44100),
        make_wav(channels=2),
        make_wav(frames=0),
        b"ID3\x04\x00mp3",
        b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 20,
        b"",
    ],
)
def test_wav_to_pcm_returns_none_for_unsuitable(data):
    assert wav_to_pcm(data) is None


# ---- client against a fake server ----


class FakeAsr:
    def __init__(self):
        self.mode = "ok"
        self.headers = None
        self.path = None
        self.frames: list[bytes] = []
        self.text = "Hello, world."

    async def process_request(self, connection, request):
        self.headers = request.headers
        self.path = request.path
        if self.mode == "reject":
            body = b'{"error":"[resource_id=x] requested resource not granted"}'
            headers = Headers([("Content-Length", str(len(body))), ("X-Tt-Logid", "LOG123")])
            return Response(403, "Forbidden", headers, body)
        if self.mode == "reject500":
            return Response(500, "Error", Headers([("Content-Length", "0")]), b"")
        return None

    async def handler(self, ws):
        first = await ws.recv()
        self.frames.append(first)
        if self.mode == "error":
            await ws.send(server_error(45000292, "quota exceeded for types: concurrency"))
            await ws.close()
            return
        if self.mode == "error_other":
            await ws.send(server_error(45000001, "invalid params"))
            await ws.close()
            return
        await ws.send(server_response({"result": {"text": ""}}, seq=1))
        if self.mode == "hang":
            await asyncio.sleep(1)
            return
        if self.mode == "close":
            await ws.close()
            return
        seq = 2
        async for raw in ws:
            self.frames.append(raw)
            if self.mode == "close_mid":
                await ws.close()
                return
            if self.mode == "bomb":
                await ws.send(server_response({"pad": "0" * (5 * 1024 * 1024)}, seq=-seq, last=True, gz=True))
                return
            last = raw[1] & 0x0F == 0b0010
            if not last:
                await ws.send(server_response({"result": {"text": "partial"}}, seq=seq))
                seq += 1
                continue
            if self.mode == "garbage":
                await ws.send(b"\x11\x91\x10\x00garbage")
                return
            if self.mode == "no_text":
                await ws.send(server_response({"result": {}}, seq=-seq, last=True))
                return
            await ws.send(server_response({"result": {"text": self.text}}, seq=-seq, last=True))
            return


@pytest.fixture
async def fake():
    f = FakeAsr()
    # max_queue=None: a handler that stops reading must still see the client's close frame.
    async with serve(f.handler, "127.0.0.1", 0, process_request=f.process_request, max_queue=None) as server:
        port = server.sockets[0].getsockname()[1]
        f.url = f"ws://127.0.0.1:{port}/api/v3/sauc/bigmodel_nostream"
        yield f


def settings_for(url: str, **extra) -> Settings:
    values = dict(
        volcengine_tts_key="tts-uuid",
        asr_stream_url=url,
        asr_stream_resource_id="volc.bigasr.sauc.duration",
        asr_stream_timeout_seconds=2,
    )
    values.update(extra)
    return Settings(_env_file=None, **values)


async def test_happy_path_streams_chunks_and_returns_final_text(fake):
    pcm = b"\x00\x01" * (CHUNK_BYTES // 2 * 2 + 100)  # 3 chunks, last one short
    text = await transcribe_pcm(settings_for(fake.url), pcm)
    assert text == "Hello, world."
    assert fake.path == "/api/v3/sauc/bigmodel_nostream"
    assert fake.headers["X-Api-Key"] == "tts-uuid"
    assert fake.headers["X-Api-Resource-Id"] == "volc.bigasr.sauc.duration"
    assert len(fake.headers["X-Api-Connect-Id"]) == 36
    req = decode_frame_request(fake.frames[0])
    assert req["audio"] == {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1}
    assert req["request"]["model_name"] == "bigmodel"
    audio = fake.frames[1:]
    assert len(audio) == 3
    assert [f[1] & 0x0F for f in audio] == [0, 0, 2]
    assert b"".join(gzip.decompress(f[8:]) for f in audio) == pcm
    assert all(len(gzip.decompress(f[8:])) <= CHUNK_BYTES for f in audio)


def decode_frame_request(frame: bytes) -> dict:
    return json.loads(gzip.decompress(frame[8:]))


async def test_dedicated_asr_key_wins(fake):
    await transcribe_pcm(settings_for(fake.url, volcengine_asr_key="asr-uuid"), b"\x00\x00" * 10)
    assert fake.headers["X-Api-Key"] == "asr-uuid"


async def test_text_is_stripped(fake):
    fake.text = "  hi there \n"
    assert await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10) == "hi there"


async def test_handshake_403_is_auth_error(fake):
    fake.mode = "reject"
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10)
    assert e.value.kind == "auth"
    assert "tts-uuid" not in str(e.value) and "tts-uuid" not in e.value.detail
    assert e.value.logid == "LOG123"
    assert e.value.connect_id == fake.headers["X-Api-Connect-Id"]


async def test_handshake_500_is_upstream_error(fake):
    fake.mode = "reject500"
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10)
    assert e.value.kind == "upstream"


async def test_quota_error_frame_is_quota_error_with_code(fake):
    fake.mode = "error"
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10)
    assert e.value.kind == "quota"
    assert "45000292" in e.value.detail


async def test_other_error_frame_is_upstream_error(fake):
    fake.mode = "error_other"
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10)
    assert e.value.kind == "upstream"
    assert "45000001" in e.value.detail


async def test_server_close_mid_send_is_protocol_error(fake):
    fake.mode = "close_mid"
    pcm = b"\x00\x01" * (CHUNK_BYTES * 50)  # many chunks: the server closes while we still send
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url), pcm)
    assert e.value.kind == "protocol"


async def test_gzip_bomb_from_server_is_protocol_error(fake):
    fake.mode = "bomb"
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10)
    assert e.value.kind == "protocol"


async def test_unexpected_exception_becomes_protocol_error(fake, monkeypatch):
    def boom(raw):
        raise MemoryError()

    monkeypatch.setattr("app.asr_stream.decode_frame", boom)
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10)
    assert e.value.kind == "protocol"
    assert "MemoryError" in e.value.detail
    assert e.value.connect_id


async def test_key_not_logged_even_at_debug(fake, caplog):
    caplog.set_level(logging.DEBUG)
    await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10)
    # The fake *server* (test side) logs the headers it receives; only client records matter.
    client = [r for r in caplog.records if not r.name.startswith("websockets.server")]
    assert client is not None
    assert all("tts-uuid" not in r.getMessage() for r in client)
    assert not any(r.name == "app.asr_stream.websockets" and r.levelno < logging.INFO for r in client)
    assert logging.getLogger("app.asr_stream.websockets").level == logging.INFO


async def test_timeout(fake):
    fake.mode = "hang"
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url, asr_stream_timeout_seconds=0.3), b"\x00\x00" * 10)
    assert e.value.kind == "timeout"


async def test_early_close_is_protocol_error(fake):
    fake.mode = "close"
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10)
    assert e.value.kind == "protocol"


async def test_garbage_frame_is_protocol_error(fake):
    fake.mode = "garbage"
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10)
    assert e.value.kind == "protocol"


async def test_missing_final_text_is_empty_error(fake):
    fake.mode = "no_text"
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10)
    assert e.value.kind == "empty"


@pytest.mark.parametrize("text", ["", "   ", "\n\t ", 42, None], ids=["empty", "spaces", "ws", "int", "null"])
async def test_blank_or_non_string_final_text_is_empty_error(fake, text):
    fake.text = text
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(settings_for(fake.url), b"\x00\x00" * 10)
    assert e.value.kind == "empty"


async def test_broken_handshake_is_upstream_error():
    async def drop(reader, writer):
        writer.close()

    server = await asyncio.start_server(drop, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        with pytest.raises(AsrStreamError) as e:
            await transcribe_pcm(settings_for(f"ws://127.0.0.1:{port}/x"), b"\x00\x00" * 10)
    finally:
        server.close()
    assert e.value.kind == "upstream"


async def test_missing_key_is_not_configured():
    s = settings_for("ws://127.0.0.1:1/x", volcengine_tts_key="")
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm(s, b"\x00\x00" * 10)
    assert e.value.kind == "not_configured"


def test_settings_defaults():
    s = Settings(_env_file=None)
    assert s.upstream_asr_mode == "chat"
    assert s.asr_stream_url == "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream"
    assert s.asr_stream_resource_id == "volc.bigasr.sauc.duration"
    assert s.volcengine_asr_key == ""
    assert s.asr_stream_key == ""
    assert s.asr_stream_timeout_seconds == 30
    assert s.asr_stream_max_concurrency == 3
    assert Settings(_env_file=None, volcengine_tts_key="t").asr_stream_key == "t"
    assert Settings(_env_file=None, volcengine_tts_key="t", volcengine_asr_key="a").asr_stream_key == "a"


# ---- decompression cap, JSON depth ----


def test_decode_rejects_gzip_bomb():
    bomb = gzip.compress(b'{"a":"' + b"0" * (MAX_DECOMPRESSED_BYTES + 10) + b'"}')
    raw = bytes([0x11, 0x93, 0x11, 0]) + struct.pack(">iI", 1, len(bomb)) + bomb
    assert len(raw) < 64 * 1024
    with pytest.raises(AsrStreamError) as e:
        decode_frame(raw)
    assert e.value.kind == "protocol"


def test_decode_accepts_payload_at_the_cap_boundary():
    body = json.dumps({"result": {"text": "x" * 1000}}).encode()
    gz = gzip.compress(body)
    raw = bytes([0x11, 0x93, 0x11, 0]) + struct.pack(">iI", 1, len(gz)) + gz
    assert decode_frame(raw).payload["result"]["text"] == "x" * 1000


def test_decode_rejects_truncated_gzip():
    gz = gzip.compress(b'{"a": 1}')[:-6]
    raw = bytes([0x11, 0x93, 0x11, 0]) + struct.pack(">iI", 1, len(gz)) + gz
    with pytest.raises(AsrStreamError) as e:
        decode_frame(raw)
    assert e.value.kind == "protocol"


def test_decode_rejects_deeply_nested_json():
    body = b'{"a":' + b"[" * 200_000 + b"]" * 200_000 + b"}"
    raw = bytes([0x11, 0x93, 0x10, 0]) + struct.pack(">iI", 1, len(body)) + body
    with pytest.raises(AsrStreamError) as e:
        decode_frame(raw)
    assert e.value.kind == "protocol"


# ---- timeout budget ----


def test_stream_budget_scales_with_audio_and_is_capped():
    s = Settings(_env_file=None)
    assert stream_budget(s, 0) == 30
    assert stream_budget(s, 32000 * 10) == 40
    assert stream_budget(s, 32000 * 600) == MAX_TIMEOUT == 120


# ---- gate: concurrency cap and circuit breaker ----


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


async def test_gate_concurrency_cap():
    gate = AsrGate(2)
    assert await gate.try_enter() is None
    assert await gate.try_enter() is None
    assert await gate.try_enter() == "busy"
    gate.leave(None)
    assert await gate.try_enter() is None


@pytest.mark.parametrize("kind", ["auth", "quota"])
async def test_gate_breaker_opens_after_consecutive_auth_or_quota(kind):
    clock = Clock()
    gate = AsrGate(3, clock=clock)
    for _ in range(BREAKER_THRESHOLD):
        assert await gate.try_enter() is None
        gate.leave(kind)
    assert await gate.try_enter() == "breaker"
    clock.now += BREAKER_COOLDOWN + 0.1
    assert await gate.try_enter() is None


async def test_gate_success_resets_and_other_failures_do_not_count():
    gate = AsrGate(3, clock=Clock())
    for kind in ["auth", "auth", None, "auth", "timeout", "upstream", "auth"]:
        assert await gate.try_enter() is None
        gate.leave(kind)
    assert await gate.try_enter() is None
