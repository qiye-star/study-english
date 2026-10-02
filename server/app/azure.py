import asyncio
import re
import time
from collections.abc import Callable
from xml.sax.saxutils import escape

import httpx
from fastapi import Request

TOKEN_TTL = 8 * 60  # 秒。Azure token 有效期约 10 分钟,提前 2 分钟刷新。
VOICE_RE = re.compile(r"^[A-Za-z]{2,3}-[A-Za-z0-9]{2,8}(-[A-Za-z0-9]+)+$")


class AzureNotConfigured(Exception):
    pass


class AzureError(Exception):
    pass


def build_ssml(text: str, voice: str) -> str:
    if not VOICE_RE.fullmatch(voice):
        raise ValueError("invalid voice")
    lang = "-".join(voice.split("-")[:2])
    return (
        f"<speak version='1.0' xml:lang='{lang}'>"
        f"<voice xml:lang='{lang}' name='{voice}'>{escape(text)}</voice>"
        f"</speak>"
    )


class AzureSpeech:
    def __init__(
        self,
        http: httpx.AsyncClient,
        key: str,
        region: str,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._http = http
        self._key = key
        self._region = region
        self._clock = clock
        self._token: str | None = None
        self._expires = 0.0
        self._lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return bool(self._key and self._region)

    @property
    def region(self) -> str:
        return self._region

    async def get_token(self) -> str:
        if not self.configured:
            raise AzureNotConfigured()
        async with self._lock:
            if self._token and self._clock() < self._expires:
                return self._token
            resp = await self._http.post(
                f"https://{self._region}.api.cognitive.microsoft.com/sts/v1.0/issueToken",
                headers={"Ocp-Apim-Subscription-Key": self._key},
            )
            if resp.status_code != 200:
                raise AzureError(f"issueToken failed: {resp.status_code}")
            self._token = resp.text
            self._expires = self._clock() + TOKEN_TTL
            return self._token

    async def synthesize(self, text: str, voice: str) -> bytes:
        if not self.configured:
            raise AzureNotConfigured()
        ssml = build_ssml(text, voice)
        resp = await self._http.post(
            f"https://{self._region}.tts.speech.microsoft.com/cognitiveservices/v1",
            content=ssml.encode("utf-8"),
            headers={
                "Ocp-Apim-Subscription-Key": self._key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                "User-Agent": "enjoy-server",
            },
        )
        if resp.status_code != 200:
            raise AzureError(f"tts failed: {resp.status_code}")
        return resp.content


def get_azure(request: Request) -> AzureSpeech:
    state = request.app.state
    if not hasattr(state, "azure"):
        s = state.settings
        state.azure = AzureSpeech(state.http, s.azure_speech_key, s.azure_speech_region)
    return state.azure
