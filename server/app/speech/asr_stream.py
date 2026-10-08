"""Volcengine big-model streaming ASR client (sauc, binary WebSocket protocol).

Protocol facts verified against the real service on 2026-10-07 (see
docs/superpowers/plans/2026-10-07-volc-streaming-asr-spike.md):
- auth headers X-Api-Key (UUID key) + X-Api-Resource-Id + X-Api-Connect-Id;
- 4-byte header [version<<4|header_size, msg_type<<4|flags, serialization<<4|compression, 0];
- client: full request (type 1, JSON, gzip) then audio-only frames (type 2, gzip PCM,
  flags 0b0010 on the last one), each payload preceded by a 4-byte big-endian size;
- server: full response (type 9) with flags bit0 = sequence present, bit1 = last
  (the sequence may also be negative on the last one); payload is JSON, gzip or not;
- server error (type 15): 4-byte code, 4-byte size, JSON body.
Never log the key, the audio or the transcript.
"""
import asyncio
import gzip
import io
import json
import logging
import struct
import time
import uuid
import wave
import zlib
from dataclasses import dataclass, field
from typing import Literal

import websockets
from websockets.asyncio.client import connect

from app.core.config import Settings

logger = logging.getLogger(__name__)
# websockets logs the handshake request headers (including X-Api-Key) at DEBUG. The
# connection gets its own logger pinned at INFO so a global DEBUG level never leaks the key.
_ws_logger = logging.getLogger("app.asr_stream.websockets")
_ws_logger.setLevel(logging.INFO)

SAMPLE_RATE = 16000
CHUNK_MS = 200
CHUNK_BYTES = SAMPLE_RATE * 2 * CHUNK_MS // 1000  # 16-bit mono
MAX_MESSAGE_BYTES = 1024 * 1024
MAX_DECOMPRESSED_BYTES = 4 * 1024 * 1024
OPEN_TIMEOUT = 10.0
CLOSE_TIMEOUT = 2.0
MAX_TIMEOUT = 120.0
# Circuit breaker: after this many consecutive auth/quota failures, skip streaming for a while.
BREAKER_THRESHOLD = 3
BREAKER_COOLDOWN = 60.0
QUOTA_CODES = {45000292}

MSG_FULL_REQUEST = 0b0001
MSG_AUDIO_ONLY = 0b0010
MSG_FULL_RESPONSE = 0b1001
MSG_ERROR = 0b1111
FLAG_SEQUENCE = 0b0001
FLAG_LAST = 0b0010
SER_NONE = 0b0000
SER_JSON = 0b0001
COMP_NONE = 0b0000
COMP_GZIP = 0b0001
AUTH_STATUSES = {401, 403}

Kind = Literal["auth", "quota", "timeout", "protocol", "upstream", "empty", "not_configured"]


class AsrStreamError(Exception):
    """`kind` is safe to log; `detail` holds upstream code/message only (never text or key).
    `connect_id` / `logid` identify the attempt for vendor support (never the key)."""

    def __init__(self, kind: Kind, detail: str = ""):
        super().__init__(kind)
        self.kind = kind
        self.detail = detail
        self.connect_id = ""
        self.logid = ""


class AsrGate:
    """Per-process admission control for streaming ASR: a non-blocking concurrency cap
    (overflow goes to the fallback without connecting) and a short circuit breaker after
    repeated auth/quota failures."""

    def __init__(self, max_concurrency: int, clock=time.monotonic):
        self._sem = asyncio.Semaphore(max(1, max_concurrency))
        self._clock = clock
        self._failures = 0
        self._open_until = 0.0

    async def try_enter(self) -> str | None:
        """None if admitted (the caller must call leave()), otherwise the skip reason."""
        if self._clock() < self._open_until:
            return "breaker"
        if self._sem.locked():
            return "busy"
        await self._sem.acquire()  # not locked, so this returns without waiting
        return None

    def leave(self, kind: str | None) -> None:
        """Release the slot; `kind` is the failure kind, or None on success."""
        self._sem.release()
        if kind in ("auth", "quota"):
            self._failures += 1
            if self._failures >= BREAKER_THRESHOLD:
                self._open_until = self._clock() + BREAKER_COOLDOWN
                self._failures = 0
        elif kind is None:
            self._failures = 0


@dataclass
class Frame:
    msg_type: int
    flags: int
    sequence: int | None = None
    code: int | None = None
    payload: dict = field(default_factory=dict)

    @property
    def last(self) -> bool:
        return bool(self.flags & FLAG_LAST) or (self.sequence is not None and self.sequence < 0)


def _header(msg_type: int, flags: int, serialization: int, compression: int) -> bytes:
    return bytes([0x11, (msg_type << 4) | flags, (serialization << 4) | compression, 0x00])


def encode_full_request(payload: dict) -> bytes:
    body = gzip.compress(json.dumps(payload).encode("utf-8"))
    return _header(MSG_FULL_REQUEST, 0, SER_JSON, COMP_GZIP) + struct.pack(">I", len(body)) + body


def encode_audio(chunk: bytes, last: bool) -> bytes:
    body = gzip.compress(chunk)
    flags = FLAG_LAST if last else 0
    return _header(MSG_AUDIO_ONLY, flags, SER_NONE, COMP_GZIP) + struct.pack(">I", len(body)) + body


def _gunzip(body: bytes) -> bytes:
    """gzip-decompress with an output cap: a small frame must not inflate to gigabytes."""
    d = zlib.decompressobj(16 + zlib.MAX_WBITS)
    out = d.decompress(body, MAX_DECOMPRESSED_BYTES)
    if d.unconsumed_tail or not d.eof:
        raise AsrStreamError("protocol", "decompressed payload too large or truncated")
    return out


def decode_frame(raw) -> Frame:
    bad = AsrStreamError("protocol", "malformed frame")
    if not isinstance(raw, (bytes, bytearray)) or len(raw) < 4:
        raise bad
    if raw[0] >> 4 != 0b0001:
        raise bad
    header_size = (raw[0] & 0x0F) * 4
    msg_type, flags = raw[1] >> 4, raw[1] & 0x0F
    compression = raw[2] & 0x0F
    body = bytes(raw[header_size:])
    frame = Frame(msg_type, flags)
    try:
        if msg_type == MSG_ERROR:
            frame.code, size = struct.unpack(">II", body[:8])
            body = body[8:]
        elif msg_type == MSG_FULL_RESPONSE:
            if flags & FLAG_SEQUENCE:
                frame.sequence = struct.unpack(">i", body[:4])[0]
                body = body[4:]
            size = struct.unpack(">I", body[:4])[0]
            body = body[4:]
        else:
            raise bad
    except struct.error:
        raise bad from None
    if size != len(body):
        raise bad
    try:
        if compression == COMP_GZIP:
            body = _gunzip(body)
        payload = json.loads(body) if body else {}
    except (zlib.error, ValueError, RecursionError):
        # RecursionError guards the JSON nesting depth (pathologically nested payloads).
        raise bad from None
    if not isinstance(payload, dict):
        raise bad
    frame.payload = payload
    return frame


def wav_to_pcm(data: bytes) -> bytes | None:
    """PCM of a 16 kHz mono 16-bit WAV, or None if the clip needs another path."""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            if (
                w.getframerate() != SAMPLE_RATE
                or w.getnchannels() != 1
                or w.getsampwidth() != 2
                or w.getcomptype() != "NONE"
            ):
                return None
            pcm = w.readframes(w.getnframes())
    except (wave.Error, EOFError):
        return None
    return pcm or None


def _clean(value, limit: int = 200) -> str:
    return "".join(c if c.isprintable() else " " for c in str(value))[:limit]


def _logid(headers) -> str:
    try:
        values = headers.get_all("X-Tt-Logid")
    except Exception:  # noqa: BLE001 - diagnostics only
        return ""
    return _clean(values[0], 64) if values else ""


def _request_payload(uid: str) -> dict:
    return {
        "user": {"uid": uid},
        "audio": {"format": "pcm", "codec": "raw", "rate": SAMPLE_RATE, "bits": 16, "channel": 1},
        "request": {"model_name": "bigmodel", "enable_itn": True, "enable_punc": True},
    }


def stream_budget(settings: Settings, pcm_bytes: int) -> float:
    """Base timeout plus one real-time factor of headroom, capped at MAX_TIMEOUT."""
    return min(settings.asr_stream_timeout_seconds + pcm_bytes / (SAMPLE_RATE * 2), MAX_TIMEOUT)


async def transcribe_pcm(settings: Settings, pcm: bytes, uid: str = "server") -> str:
    """Final transcript, or AsrStreamError for any failure (so callers can always fall back).
    Cancellation (BaseException) still propagates."""
    connect_id = str(uuid.uuid4())
    try:
        return await _transcribe(settings, pcm, uid, connect_id)
    except AsrStreamError as e:
        e.connect_id = connect_id
        raise
    except Exception as e:  # noqa: BLE001 - RecursionError, MemoryError, library bugs...
        err = AsrStreamError("protocol", f"unexpected {type(e).__name__}")
        err.connect_id = connect_id
        raise err from None


async def _transcribe(settings: Settings, pcm: bytes, uid: str, connect_id: str) -> str:
    key = settings.asr_stream_key
    if not key:
        raise AsrStreamError("not_configured")
    headers = {
        "X-Api-Key": key,
        "X-Api-Resource-Id": settings.asr_stream_resource_id,
        "X-Api-Connect-Id": connect_id,
    }
    logid = ""
    try:
        async with asyncio.timeout(stream_budget(settings, len(pcm))):
            async with connect(
                settings.asr_stream_url,
                additional_headers=headers,
                open_timeout=OPEN_TIMEOUT,
                max_size=MAX_MESSAGE_BYTES,
                close_timeout=CLOSE_TIMEOUT,
                logger=_ws_logger,
            ) as ws:
                logid = _logid(ws.response.headers)
                await ws.send(encode_full_request(_request_payload(uid)))
                sender = asyncio.create_task(_send_audio(ws, pcm))
                try:
                    text = await _collect(ws)
                finally:
                    sender.cancel()
                    await asyncio.gather(sender, return_exceptions=True)
    except AsrStreamError as e:
        e.logid = logid
        raise
    except TimeoutError:
        err = AsrStreamError("timeout")
        err.logid = logid
        raise err from None
    except websockets.InvalidStatus as e:
        status = e.response.status_code
        kind: Kind = "auth" if status in AUTH_STATUSES else "upstream"
        err = AsrStreamError(kind, f"http={status}")
        err.logid = _logid(e.response.headers)
        raise err from None
    except (OSError, websockets.WebSocketException) as e:
        err = AsrStreamError("upstream", type(e).__name__)
        err.logid = logid
        raise err from None
    text = text.strip()
    if not text:
        err = AsrStreamError("empty")
        err.logid = logid
        raise err
    return text


async def _send_audio(ws, pcm: bytes) -> None:
    chunks = [pcm[i : i + CHUNK_BYTES] for i in range(0, len(pcm), CHUNK_BYTES)] or [b""]
    last = len(chunks) - 1
    try:
        for i, chunk in enumerate(chunks):
            await ws.send(encode_audio(chunk, i == last))
    except websockets.ConnectionClosed:
        # The server may have sent an error frame before closing; _collect reports it.
        pass


async def _collect(ws) -> str:
    try:
        async for raw in ws:
            frame = decode_frame(raw)
            if frame.msg_type == MSG_ERROR:
                message = _clean(frame.payload.get("error") or frame.payload.get("message") or "")
                quota = frame.code in QUOTA_CODES or "quota" in message.lower()
                kind: Kind = "quota" if quota else "upstream"
                raise AsrStreamError(kind, f"code={frame.code} message={message}")
            if frame.last:
                result = frame.payload.get("result")
                text = result.get("text") if isinstance(result, dict) else None
                return text if isinstance(text, str) else ""
    except websockets.ConnectionClosedError:
        pass
    raise AsrStreamError("protocol", "closed before the final result")
