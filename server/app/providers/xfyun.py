import asyncio
import base64
import hashlib
import hmac
import json
import re
from datetime import datetime, timezone
from email.utils import format_datetime
from urllib.parse import urlencode, urlsplit

import websockets
from websockets.asyncio.client import connect

from app.core import metering

FRAME_BYTES = 1280
MAX_MESSAGE_BYTES = 1024 * 1024
MAX_XML_BYTES = 1024 * 1024


_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_INVALID = "Invalid response from speech service"


def _clean_message(value: object) -> str:
    text = _CONTROL_CHARS.sub(" ", str(value))[:200].strip()
    return text or "Speech service error"


class XfyunError(Exception):
    """Upstream failure. Callers must map by `code` and never return `message`
    to API clients: it can carry provider-supplied text."""

    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.message = message
        self.code = code


class XfyunNotConfigured(Exception):
    pass


def signed_url(
    ws_url: str, api_key: str, api_secret: str, now: datetime | None = None
) -> str:
    parts = urlsplit(ws_url)
    host = parts.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    if parts.port is not None:
        host = f"{host}:{parts.port}"
    path = parts.path or "/"
    date = format_datetime(now or datetime.now(timezone.utc), usegmt=True)
    origin = f"host: {host}\ndate: {date}\nGET {path} HTTP/1.1"
    digest = hmac.new(api_secret.encode(), origin.encode(), hashlib.sha256).digest()
    signature = base64.b64encode(digest).decode()
    authorization = base64.b64encode(
        (
            f'api_key="{api_key}", algorithm="hmac-sha256", '
            f'headers="host date request-line", signature="{signature}"'
        ).encode()
    ).decode()
    query = urlencode({"authorization": authorization, "date": date, "host": host})
    return f"{parts.scheme}://{host}{path}?{query}"


def _first_frame(app_id: str, text: str, ent: str) -> dict:
    return {
        "common": {"app_id": app_id},
        "business": {
            "category": "read_sentence",
            "rstcd": "utf8",
            "sub": "ise",
            "group": "adult",
            "ent": ent,
            "tte": "utf-8",
            "cmd": "ssb",
            "auf": "audio/L16;rate=16000",
            "aue": "raw",
            "text": "﻿[content]\n" + text,
            "ise_unite": "1",
            "rst": "entirety",
            "extra_ability": "multi_dimension",
        },
        "data": {"status": 0},
    }


def _audio_frames(pcm: bytes):
    chunks = [pcm[i : i + FRAME_BYTES] for i in range(0, len(pcm), FRAME_BYTES)] or [b""]
    last = len(chunks) - 1
    for i, chunk in enumerate(chunks):
        yield {
            "business": {
                "cmd": "auw",
                "aus": 4 if i == last else (1 if i == 0 else 2),
                "aue": "raw",
            },
            "data": {
                "status": 2 if i == last else 1,
                "data": base64.b64encode(chunk).decode(),
                "data_type": 1,
                "encoding": "raw",
            },
        }


def _parse_message(raw: str | bytes) -> dict:
    if len(raw) > MAX_MESSAGE_BYTES:
        raise XfyunError("Response message too large")
    try:
        msg = json.loads(raw)
    except ValueError:
        raise XfyunError("Invalid response from speech service") from None
    if not isinstance(msg, dict):
        raise XfyunError("Invalid response from speech service")
    return msg


class XfyunIse:
    def __init__(self, app_id: str, api_key: str, api_secret: str, ws_url: str):
        self.app_id = app_id
        self.api_key = api_key
        self.api_secret = api_secret
        self.ws_url = ws_url

    @property
    def configured(self) -> bool:
        return bool(self.app_id and self.api_key and self.api_secret)

    async def evaluate(
        self, pcm: bytes, text: str, ent: str, timeout: float = 60.0
    ) -> str:
        if not self.configured:
            raise XfyunNotConfigured()
        url = signed_url(self.ws_url, self.api_key, self.api_secret)
        timer, status = metering.Timer(), 0
        try:
            async with asyncio.timeout(timeout):
                async with connect(url, max_size=MAX_MESSAGE_BYTES) as ws:
                    await ws.send(json.dumps(_first_frame(self.app_id, text, ent)))
                    try:
                        for frame in _audio_frames(pcm):
                            await ws.send(json.dumps(frame))
                    except websockets.ConnectionClosed:
                        # Provider may have sent an error frame before closing;
                        # fall through so _collect can read it.
                        pass
                    xml = await self._collect(ws)
                    status = 200
                    return xml
        except XfyunError:
            status = 502
            raise
        except TimeoutError:
            raise XfyunError("Speech service timed out") from None
        except websockets.InvalidStatus as e:
            status = e.response.status_code
            raise XfyunError("Speech service connection failed") from None
        except (OSError, websockets.WebSocketException):
            # Deliberately generic: never echo the signed URL or its details.
            raise XfyunError("Speech service connection failed") from None
        finally:
            metering.record("assess_xfyun", "xfyun", "ise", status, timer.ms(), units_in=metering.pcm_ms(len(pcm)),
                            unit="audio_ms")

    @staticmethod
    async def _collect(ws) -> str:
        parts: list[bytes] = []
        size = 0
        async for raw in ws:
            msg = _parse_message(raw)
            code = msg.get("code")
            if not isinstance(code, int) or isinstance(code, bool):
                raise XfyunError(_INVALID)
            if code != 0:
                raise XfyunError(_clean_message(msg.get("message") or ""), code)
            data = msg.get("data")
            if data is None:
                data = {}
            if not isinstance(data, dict):
                raise XfyunError(_INVALID)
            payload = data.get("data")
            if payload:
                if not isinstance(payload, str):
                    raise XfyunError(_INVALID)
                try:
                    chunk = base64.b64decode(payload)
                except ValueError:
                    raise XfyunError("Invalid response from speech service") from None
                size += len(chunk)
                if size > MAX_XML_BYTES:
                    raise XfyunError("Response too large")
                parts.append(chunk)
            if data.get("status") == 2:
                try:
                    return b"".join(parts).decode("utf-8")
                except UnicodeDecodeError:
                    raise XfyunError("Invalid response from speech service") from None
        raise XfyunError("Speech service closed the connection early")
