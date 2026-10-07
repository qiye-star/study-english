"""逐句识别抽象(计划 R3/R25)。一句话 = 一个识别器:send_audio* → finish() → 文本。

`make_transcriber` 与上传识别接口 `/api/ai/audio/transcriptions` 走同一条路:
`UPSTREAM_ASR_MODE=volc_stream` 时先用已落地的 `asr_stream.transcribe_pcm`(共用进程内的
并发闸门/熔断 `app.state.asr_gate`),任何 `AsrStreamError` 都回落到 chat/Whisper 路径;
没配置回落时按接口的错误口径映射为 `AsrError`(流式结果为空除外:返回 "")。
空串 = 没听清(R4:`<none>` → "")。
导入方向只能是 asr → asr_stream(R21),asr_stream 不得反向导入本模块。
日志只记类别、编号与耗时,不记转写或密钥。
"""
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Literal, Protocol

import httpx
from fastapi import HTTPException

from app.asr_stream import SAMPLE_RATE, AsrGate, AsrStreamError, transcribe_pcm, wav_to_pcm
from app.config import Settings
from app.stt import pcm_to_wav, transcribe_wav
from app.timing import log_timing

logger = logging.getLogger(__name__)

MAX_UTTERANCE_BYTES = 60 * 16000 * 2


class AsrError(Exception):
    def __init__(self, kind: Literal["auth", "upstream", "config"]):
        super().__init__(kind)
        self.kind = kind


class UtteranceRecognizer(Protocol):
    async def send_audio(self, pcm: bytes) -> None: ...

    async def finish(self) -> str: ...

    async def abort(self) -> None: ...


PartialCallback = Callable[[str], Awaitable[None]]
RecognizerFactory = Callable[[PartialCallback], Awaitable[UtteranceRecognizer]]
Transcribe = Callable[[bytes], Awaitable[str]]


class BufferedRecognizer:
    """客户端 VAD 断句 + 整段上传识别(兜底)。从不调用 partial 回调。"""

    def __init__(self, transcribe: Transcribe):
        self._transcribe = transcribe
        self._pcm = bytearray()

    async def send_audio(self, pcm: bytes) -> None:
        room = MAX_UTTERANCE_BYTES - len(self._pcm)
        if room > 0:
            self._pcm += pcm[:room]

    async def finish(self) -> str:
        pcm, self._pcm = bytes(self._pcm), bytearray()
        if not pcm:
            return ""
        return await self._transcribe(pcm_to_wav(pcm))

    async def abort(self) -> None:
        self._pcm = bytearray()


def shared_asr_gate(state, settings: Settings) -> AsrGate:
    """进程内唯一的流式识别闸门(与上传识别接口的 `_asr_gate` 是同一个 `state.asr_gate`)。"""
    if not hasattr(state, "asr_gate"):
        state.asr_gate = AsrGate(settings.asr_stream_max_concurrency)
    return state.asr_gate


def _fallback_configured(settings: Settings) -> bool:
    if not settings.upstream_whisper_base_url:
        return False
    return settings.upstream_whisper_mode != "chat" or bool(settings.upstream_whisper_model)


def _stream_usable(settings: Settings) -> bool:
    return settings.asr_stream_enabled and bool(settings.asr_stream_key)


def _map_http(e: HTTPException) -> AsrError:
    if e.status_code == 503:
        return AsrError("config")
    if e.status_code == 502 and "authentication" in str(e.detail).lower():
        return AsrError("auth")
    return AsrError("upstream")


def _map_stream(kind: str) -> AsrError:
    # 与上传识别接口在"没有回落"时的口径一致:not_configured → 503,auth → 502 鉴权,其余 → 502。
    if kind == "not_configured":
        return AsrError("config")
    if kind == "auth":
        return AsrError("auth")
    return AsrError("upstream")


async def _try_stream(settings: Settings, gate: AsrGate, pcm: bytes, uid: str, fallback: bool) -> str | None:
    """流式识别的文本;None 表示应走回落(没有回落时直接抛 AsrError)。
    没有回落时,流式结果为空(`empty`)= 没听清,返回 "",不是错误(复核 1.5-I1;
    上传识别接口 ai_audio 仍按 R4 口径处理,不受影响)。取消对熔断计数是中性的。"""
    audio_s = len(pcm) / (SAMPLE_RATE * 2)
    skip = await gate.try_enter()
    if skip is not None:
        logger.warning("asr volc_stream skipped reason=%s audio_s=%.2f fallback=%s", skip, audio_s, fallback)
        if not fallback:
            raise AsrError("upstream")
        return None
    started = time.perf_counter()
    kind = "aborted"  # cancelled (or anything unexpected) → neutral for the breaker
    try:
        text = await transcribe_pcm(settings, pcm, uid)
        kind = None
    except AsrStreamError as e:
        kind = e.kind
        ms = round((time.perf_counter() - started) * 1000)
        log_timing("stt_volc_stream", ms=ms, audio_bytes=len(pcm), status=0)
        logger.warning(
            "asr volc_stream failed kind=%s detail=%s ms=%d audio_s=%.2f fallback=%s connect_id=%s logid=%s",
            e.kind, e.detail, ms, audio_s, fallback, e.connect_id, e.logid,
        )
        if not fallback:
            if e.kind == "empty":
                return ""
            raise _map_stream(e.kind) from None
        return None
    finally:
        gate.leave(kind)
    log_timing("stt_volc_stream", ms=round((time.perf_counter() - started) * 1000), audio_bytes=len(pcm), status=200)
    return text


def make_transcriber(
    http: httpx.AsyncClient,
    settings: Settings,
    language: str | None = "en",
    *,
    gate: AsrGate | None = None,
    uid: str = "server",
) -> Transcribe:
    """WAV → 文本。应用内调用方应传 `gate=shared_asr_gate(app.state, settings)`;
    不传时(测试、脚本)用本转写器自己的闸门。"""
    if gate is None and settings.asr_stream_enabled:
        gate = AsrGate(settings.asr_stream_max_concurrency)

    async def transcribe(wav: bytes) -> str:
        if settings.asr_stream_enabled:
            pcm = wav_to_pcm(wav)
            if pcm is not None:
                text = await _try_stream(settings, gate, pcm, uid, _fallback_configured(settings))
                if text is not None:
                    return text
        try:
            return await transcribe_wav(http, settings, wav, language)
        except HTTPException as e:
            raise _map_http(e) from None

    return transcribe


def buffered_factory(transcribe: Transcribe) -> RecognizerFactory:
    async def factory(_on_partial: PartialCallback) -> UtteranceRecognizer:
        return BufferedRecognizer(transcribe)

    return factory


def realtime_factory(
    http: httpx.AsyncClient,
    settings: Settings,
    language: str | None = "en",
    *,
    gate: AsrGate | None = None,
    uid: str = "server",
    stream_factory: RecognizerFactory | None = None,
) -> RecognizerFactory:
    """按 `REALTIME_ASR_MODE` 选通话的识别器。`stream` 的实现(Task 1.6 的 `volc_stream_factory`)
    由调用方注入,本模块不导入它(避免循环导入)。所选模式不可用 → `AsrError("config")`。"""
    if settings.realtime_asr_mode == "stream":
        if stream_factory is None or not settings.asr_stream_key:
            raise AsrError("config")
        return stream_factory
    if not (_stream_usable(settings) or _fallback_configured(settings)):
        raise AsrError("config")
    return buffered_factory(make_transcriber(http, settings, language, gate=gate, uid=uid))
