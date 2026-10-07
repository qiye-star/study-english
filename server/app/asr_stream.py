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
import uuid
import wave
from dataclasses import dataclass, field
from typing import Literal

import websockets
from websockets.asyncio.client import connect

from app.config import Settings

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
CHUNK_MS = 200
CHUNK_BYTES = SAMPLE_RATE * 2 * CHUNK_MS // 1000  # 16-bit mono
MAX_MESSAGE_BYTES = 1024 * 1024
OPEN_TIMEOUT = 10.0

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

Kind = Literal["auth", "timeout", "protocol", "upstream", "empty", "not_configured"]


class AsrStreamError(Exception):
    """`kind` is safe to log; `detail` holds upstream code/message only (never text or key)."""

    def __init__(self, kind: Kind, detail: str = ""):
        super().__init__(kind)
        self.kind = kind
        self.detail = detail


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
            body = gzip.decompress(body)
        payload = json.loads(body) if body else {}
    except (OSError, EOFError, ValueError):
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


def _request_payload(uid: str) -> dict:
    return {
        "user": {"uid": uid},
        "audio": {"format": "pcm", "codec": "raw", "rate": SAMPLE_RATE, "bits": 16, "channel": 1},
        "request": {"model_name": "bigmodel", "enable_itn": True, "enable_punc": True},
    }


async def transcribe_pcm(settings: Settings, pcm: bytes, uid: str = "server") -> str:
    key = settings.asr_stream_key
    if not key:
        raise AsrStreamError("not_configured")
    headers = {
        "X-Api-Key": key,
        "X-Api-Resource-Id": settings.asr_stream_resource_id,
        "X-Api-Connect-Id": str(uuid.uuid4()),
    }
    try:
        # Base budget plus one real-time factor of headroom for long clips.
        budget = settings.asr_stream_timeout_seconds + len(pcm) / (SAMPLE_RATE * 2)
        async with asyncio.timeout(budget):
            async with connect(
                settings.asr_stream_url,
                additional_headers=headers,
                open_timeout=OPEN_TIMEOUT,
                max_size=MAX_MESSAGE_BYTES,
            ) as ws:
                await ws.send(encode_full_request(_request_payload(uid)))
                sender = asyncio.create_task(_send_audio(ws, pcm))
                try:
                    text = await _collect(ws)
                finally:
                    sender.cancel()
                    await asyncio.gather(sender, return_exceptions=True)
    except AsrStreamError:
        raise
    except TimeoutError:
        raise AsrStreamError("timeout") from None
    except websockets.InvalidStatus as e:
        status = e.response.status_code
        kind: Kind = "auth" if status in AUTH_STATUSES else "upstream"
        raise AsrStreamError(kind, f"http={status}") from None
    except (OSError, websockets.WebSocketException) as e:
        raise AsrStreamError("upstream", type(e).__name__) from None
    text = text.strip()
    if not text:
        raise AsrStreamError("empty")
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
                message = frame.payload.get("error") or frame.payload.get("message") or ""
                raise AsrStreamError("upstream", f"code={frame.code} message={_clean(message)}")
            if frame.last:
                result = frame.payload.get("result")
                text = result.get("text") if isinstance(result, dict) else None
                return text if isinstance(text, str) else ""
    except websockets.ConnectionClosedError:
        pass
    raise AsrStreamError("protocol", "closed before the final result")
