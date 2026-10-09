import base64
import binascii
import json
import logging
import re
from collections.abc import AsyncIterator
from typing import Literal

import httpx

from app.core import metering

SUCCESS_END_CODE = 20000000
AUTH_STATUSES = {401, 403}
TIMEOUT = httpx.Timeout(120.0, connect=10.0)


logger = logging.getLogger(__name__)
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def _clean(value, limit: int = 200) -> str:
    return _CONTROL.sub(" ", str(value))[:limit]


def _error_info(raw: bytes) -> tuple[str, str]:
    """Best-effort upstream code/message from an error body (never the text or key)."""
    try:
        item = json.loads(raw)
    except ValueError:
        return "", ""
    if isinstance(item, dict) and isinstance(item.get("header"), dict):
        item = item["header"]
    if not isinstance(item, dict):
        return "", ""
    return _clean(item.get("code", "")), _clean(item.get("message", ""))


class VolcengineError(Exception):
    def __init__(self, kind: Literal["auth", "upstream"], detail: str = ""):
        super().__init__(kind)
        self.kind = kind
        self.detail = detail


class StreamParser:
    """增量解析火山 TTS 的拼接 JSON 流(每个对象一块 base64 音频)。"""

    def __init__(self, max_buffer: int = 4 * 1024 * 1024):
        self._decoder = json.JSONDecoder()
        self._text = ""
        self._pending = b""
        self._max = max_buffer
        self.audio_bytes = 0

    def _decode(self, data: bytes) -> str:
        raw = self._pending + data
        try:
            self._pending = b""
            return raw.decode("utf-8")
        except UnicodeDecodeError as e:
            if e.reason != "unexpected end of data":
                raise VolcengineError("upstream")
            self._pending = raw[e.start:]  # 多字节字符被块边界切开:留到下一块
            return raw[: e.start].decode("utf-8")

    def _audio(self, item) -> bytes | None:
        if not isinstance(item, dict):
            raise VolcengineError("upstream")
        code = item.get("code")
        if code not in (None, 0, SUCCESS_END_CODE):
            raise VolcengineError("upstream", f"code={_clean(code)} message={_clean(item.get('message', ''))}")
        data = item.get("data")
        if isinstance(data, str) and data:
            try:
                chunk = base64.b64decode(data, validate=True)
            except (binascii.Error, ValueError):
                raise VolcengineError("upstream")
            self.audio_bytes += len(chunk)
            return chunk
        return None

    def feed(self, data: bytes) -> list[bytes]:
        self._text += self._decode(data)
        out: list[bytes] = []
        while True:
            stripped = self._text.lstrip()
            if not stripped:
                self._text = ""
                return out
            try:
                item, end = self._decoder.raw_decode(stripped)
            except ValueError:
                self._text = stripped
                if len(self._text) > self._max:
                    raise VolcengineError("upstream")
                return out
            self._text = stripped[end:]
            chunk = self._audio(item)
            if chunk:
                out.append(chunk)

    def finish(self) -> None:
        if self._pending or self._text.strip() or not self.audio_bytes:
            raise VolcengineError("upstream")


def parse_stream(raw: bytes) -> bytes:
    """Join the base64 audio chunks of a concatenated-JSON response into one MP3."""
    parser = StreamParser()
    chunks = parser.feed(raw)
    parser.finish()
    return b"".join(chunks)


def _meter(url: str, resource_id: str, text: str, status: int, timer: metering.Timer) -> None:
    metering.record("tts", metering.provider_of(url), resource_id, status, timer.ms(), units_in=len(text),
                    unit="chars")


async def synthesize(
    http: httpx.AsyncClient,
    url: str,
    api_key: str,
    resource_id: str,
    text: str,
    speaker: str,
    uid: str,
) -> bytes:
    timer = metering.Timer()
    try:
        response = await http.post(
            url,
            json={
                "user": {"uid": uid},
                "req_params": {
                    "text": text,
                    "speaker": speaker,
                    "audio_params": {"format": "mp3", "sample_rate": 24000},
                },
            },
            headers={"X-Api-Key": api_key, "X-Api-Resource-Id": resource_id},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as e:
        _meter(url, resource_id, text, 0, timer)
        logger.warning("Volcengine TTS request failed: %s", type(e).__name__)
        raise VolcengineError("upstream")
    _meter(url, resource_id, text, response.status_code, timer)
    if response.status_code != 200:
        code, message = _error_info(response.content)
        logger.warning(
            "Volcengine TTS HTTP %s code=%s message=%s", response.status_code, code, message
        )
        kind = "auth" if response.status_code in AUTH_STATUSES else "upstream"
        raise VolcengineError(kind)
    try:
        return parse_stream(response.content)
    except VolcengineError as e:
        logger.warning("Volcengine TTS bad response: %s", e.detail or "no audio data")
        raise


async def synthesize_stream(
    http: httpx.AsyncClient,
    url: str,
    api_key: str,
    resource_id: str,
    text: str,
    speaker: str,
    uid: str,
    audio_format: Literal["mp3", "pcm"] = "mp3",
    sample_rate: int = 24000,
) -> AsyncIterator[bytes]:
    request = http.build_request(
        "POST", url,
        json={"user": {"uid": uid}, "req_params": {
            "text": text, "speaker": speaker, "audio_params": {"format": audio_format, "sample_rate": sample_rate}}},
        headers={"X-Api-Key": api_key, "X-Api-Resource-Id": resource_id},
        timeout=TIMEOUT,
    )
    timer = metering.Timer()
    try:
        response = await http.send(request, stream=True)
    except httpx.HTTPError as e:
        _meter(url, resource_id, text, 0, timer)
        logger.warning("Volcengine TTS request failed: %s", type(e).__name__)
        raise VolcengineError("upstream")
    _meter(url, resource_id, text, response.status_code, timer)  # ms = time to the response headers
    try:
        if response.status_code != 200:
            code, message = _error_info(await response.aread())
            logger.warning("Volcengine TTS HTTP %s code=%s message=%s", response.status_code, code, message)
            raise VolcengineError("auth" if response.status_code in AUTH_STATUSES else "upstream")
        parser = StreamParser()
        async for data in response.aiter_bytes():
            for chunk in parser.feed(data):
                yield chunk
        parser.finish()
    except httpx.HTTPError as e:
        logger.warning("Volcengine TTS stream failed: %s", type(e).__name__)
        raise VolcengineError("upstream")
    finally:
        await response.aclose()
