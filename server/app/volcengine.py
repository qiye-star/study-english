import base64
import binascii
import json
import logging
import re
from typing import Literal

import httpx

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


def parse_stream(raw: bytes) -> bytes:
    """Join the base64 audio chunks of a concatenated-JSON response into one MP3."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise VolcengineError("upstream")
    decoder = json.JSONDecoder()
    pos, end = 0, len(text)
    chunks: list[bytes] = []
    while True:
        while pos < end and text[pos].isspace():
            pos += 1
        if pos >= end:
            break
        try:
            item, pos = decoder.raw_decode(text, pos)
        except ValueError:
            raise VolcengineError("upstream")
        if not isinstance(item, dict):
            raise VolcengineError("upstream")
        code = item.get("code")
        if code not in (None, 0, SUCCESS_END_CODE):
            raise VolcengineError(
                "upstream", f"code={_clean(code)} message={_clean(item.get('message', ''))}"
            )
        data = item.get("data")
        if isinstance(data, str) and data:
            try:
                chunks.append(base64.b64decode(data, validate=True))
            except (binascii.Error, ValueError):
                raise VolcengineError("upstream")
    audio = b"".join(chunks)
    if not audio:
        raise VolcengineError("upstream")
    return audio


async def synthesize(
    http: httpx.AsyncClient,
    url: str,
    api_key: str,
    resource_id: str,
    text: str,
    speaker: str,
    uid: str,
) -> bytes:
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
        logger.warning("Volcengine TTS request failed: %s", type(e).__name__)
        raise VolcengineError("upstream")
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
