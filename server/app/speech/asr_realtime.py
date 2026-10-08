"""Realtime streaming recognizer for calls (Task 1.6, ruling R21): one `bigmodel_async`
connection per utterance, fed with the client's audio as it arrives.

Parameters are the ones verified by the Task 0.4 spike
(docs/superpowers/plans/2026-10-07-voice-spike-results.md §2.3):
- URL `settings.asr_realtime_url`, auth headers as `asr_stream` (X-Api-Key = asr_stream_key,
  X-Api-Resource-Id, X-Api-Connect-Id);
- request `model_name=bigmodel, enable_itn, enable_punc, show_utterances, enable_nonstream,
  end_window_size=800`, no `result_type` (each frame's `result.text` is the full text so far);
- the turn ends when the *client* says so (`finish()`): we send 100 ms of silence with the
  last-packet flag (an empty last packet is unverified) and the last response's `result.text`
  is the final text. Server-side segmentation (`definite`) is only display material.
- silence only → no text frames, then a normal last frame with empty text → "" (no speech).

Frame codec, error classification and the gate/breaker come from `app.speech.asr_stream`; every
`AsrStreamError` becomes an `AsrError` for callers. Import direction: asr_realtime → asr_stream
/ asr only (asr.py receives this factory by injection, see `asr.realtime_factory`).
Unverified upstream limits (max connection duration, idle cut-off) are handled defensively with
timeouts; any failure raises `AsrError` so the caller can fall back to `BufferedRecognizer`
(`VolcStreamRecognizer.audio` keeps the utterance's PCM for that).
Logs carry kinds, codes, ids and timings only — never the key, the audio or any text.
"""
import asyncio
import logging
import time
import uuid

import websockets
from websockets.asyncio.client import connect as ws_connect

from app.speech.asr import (
    MAX_UTTERANCE_BYTES,
    AsrError,
    PartialCallback,
    RecognizerFactory,
    _map_stream,
)
from app.speech.asr_stream import (
    AUTH_STATUSES,
    CLOSE_TIMEOUT,
    MAX_MESSAGE_BYTES,
    MSG_ERROR,
    QUOTA_CODES,
    SAMPLE_RATE,
    AsrGate,
    AsrStreamError,
    Frame,
    _clean,
    _logid,
    decode_frame,
    encode_audio,
    encode_full_request,
)
from app.core.config import Settings

logger = logging.getLogger(__name__)
# websockets logs handshake headers (incl. X-Api-Key) at DEBUG: pin the connection logger at INFO.
_ws_logger = logging.getLogger("app.asr_realtime.websockets")
_ws_logger.setLevel(logging.INFO)

OPEN_TIMEOUT = 5.0  # connect + full request + first (empty) response; spike: 160–210 ms + ~60 ms
SEND_TIMEOUT = 5.0
IDLE_TIMEOUT = 15.0  # no audio from the caller for this long → give the connection up
FINAL_TIMEOUT = 5.0  # last packet → final result; spike: 68–92 ms
MAX_FRAME_PCM_BYTES = 32000  # 1 s per audio frame at most
LAST_CHUNK_BYTES = SAMPLE_RATE * 2 // 10  # 100 ms of silence carries the last-packet flag


def _request_payload(uid: str) -> dict:
    return {
        "user": {"uid": uid},
        "audio": {"format": "pcm", "codec": "raw", "rate": SAMPLE_RATE, "bits": 16, "channel": 1},
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,
            "enable_punc": True,
            "show_utterances": True,
            "enable_nonstream": True,
            "end_window_size": 800,
        },
    }


def _text(frame: Frame) -> str:
    """`result.text` with whitespace tidied (the second pass joins segments with double spaces)."""
    result = frame.payload.get("result")
    text = result.get("text") if isinstance(result, dict) else None
    return " ".join(text.split()) if isinstance(text, str) else ""


def _error_from(frame: Frame) -> AsrStreamError:
    """Same classification as `asr_stream`: 45000292 or a quota message → quota."""
    message = _clean(frame.payload.get("error") or frame.payload.get("message") or "")
    quota = frame.code in QUOTA_CODES or "quota" in message.lower()
    return AsrStreamError("quota" if quota else "upstream", f"code={frame.code} message={message}")


class VolcStreamRecognizer:
    """One utterance on one open connection. Created by `volc_stream_factory`, which has
    already sent the request and received the first response and holds a gate slot; the
    recognizer owns both and releases them exactly once."""

    def __init__(
        self,
        ws,
        on_partial: PartialCallback,
        gate: AsrGate,
        *,
        connect_id: str = "",
        logid: str = "",
        idle_timeout: float = IDLE_TIMEOUT,
        final_timeout: float = FINAL_TIMEOUT,
    ):
        self._ws = ws
        self._on_partial = on_partial
        self._gate = gate
        self._connect_id = connect_id
        self._logid = logid
        self._idle_timeout = idle_timeout
        self._final_timeout = final_timeout
        self._audio = bytearray()
        self._partial = ""
        self._partials = 0
        self._final: str | None = None
        self._failure: AsrStreamError | None = None
        self._finishing = False
        self._closed = False
        self._released = False
        self._started = time.perf_counter()
        loop = asyncio.get_running_loop()
        self._deadline = loop.time() + idle_timeout
        self._timeout: asyncio.Timeout | None = None
        self._reader = asyncio.create_task(self._read())

    @property
    def audio(self) -> bytes:
        """The PCM forwarded so far (capped like `BufferedRecognizer`), for a fallback."""
        return bytes(self._audio)

    # ---- internals ----

    def _reschedule(self, seconds: float) -> None:
        self._deadline = asyncio.get_running_loop().time() + seconds
        timeout = self._timeout
        if timeout is not None and not timeout.expired():
            timeout.reschedule(self._deadline)

    def _release(self, kind: str | None) -> None:
        if not self._released:
            self._released = True
            self._gate.leave(kind)

    def _fail(self, err: AsrStreamError) -> None:
        if self._failure is not None or self._final is not None:
            return
        self._failure = err
        logger.warning(
            "asr realtime failed kind=%s detail=%s ms=%d audio_s=%.2f partials=%d connect_id=%s logid=%s",
            err.kind, err.detail, self._ms(), len(self._audio) / (SAMPLE_RATE * 2), self._partials,
            self._connect_id, self._logid,
        )
        self._release(err.kind)

    def _ms(self) -> int:
        return round((time.perf_counter() - self._started) * 1000)

    def _error(self) -> AsrError:
        return _map_stream(self._failure.kind) if self._failure is not None else AsrError("upstream")

    async def _read(self) -> None:
        try:
            async with asyncio.timeout_at(self._deadline) as timeout:
                self._timeout = timeout
                async for raw in self._ws:
                    frame = decode_frame(raw)
                    if frame.msg_type == MSG_ERROR:
                        raise _error_from(frame)
                    text = _text(frame)
                    if frame.last:
                        self._final = text
                        self._release(None)  # upstream is done: success for the breaker
                        break
                    if text and text != self._partial:
                        self._partial = text
                        self._partials += 1
                        try:
                            await self._on_partial(text)
                        except Exception as e:  # noqa: BLE001 - partials are display only
                            logger.warning("asr realtime partial callback failed: %s", type(e).__name__)
            if self._final is None:
                raise AsrStreamError("protocol", "closed before the final result")
        except AsrStreamError as e:
            self._fail(e)
        except TimeoutError:
            self._fail(AsrStreamError("timeout", "final" if self._finishing else "idle"))
        except websockets.ConnectionClosed:
            self._fail(AsrStreamError("protocol", "closed before the final result"))
        except Exception as e:  # noqa: BLE001 - RecursionError, MemoryError, library bugs...
            self._fail(AsrStreamError("protocol", f"unexpected {type(e).__name__}"))
        finally:
            self._timeout = None  # the watchdog is gone; `_reschedule` must not touch it
        # Final received (slot already released as a success), failed or idle (released by
        # `_fail`): the connection has no further use; drop it now.
        await self._ws.close()

    async def _close(self) -> None:
        if self._closed:
            return
        self._closed = True
        # A cancellation at any await below must still close the socket and free the slot.
        try:
            if not self._reader.done():
                self._reader.cancel()
                await asyncio.gather(self._reader, return_exceptions=True)
        finally:
            try:
                await self._ws.close()
            finally:
                self._release("aborted")  # neutral for the breaker

    async def _send(self, frame: bytes) -> None:
        async with asyncio.timeout(SEND_TIMEOUT):
            await self._ws.send(frame)

    async def _send_failed(self, e: BaseException) -> AsrError:
        # The reader may be about to report why (an error frame queued before the close).
        await asyncio.wait({self._reader}, timeout=0.5)
        self._fail(AsrStreamError("timeout" if isinstance(e, TimeoutError) else "protocol", type(e).__name__))
        await self._close()
        return self._error()

    # ---- UtteranceRecognizer ----

    async def send_audio(self, pcm: bytes) -> None:
        if self._failure is not None or self._closed or self._finishing:
            raise self._error()
        pcm = pcm[: MAX_UTTERANCE_BYTES - len(self._audio)]
        if not pcm:
            return
        self._audio += pcm
        self._reschedule(self._idle_timeout)
        try:
            for i in range(0, len(pcm), MAX_FRAME_PCM_BYTES):
                await self._send(encode_audio(pcm[i : i + MAX_FRAME_PCM_BYTES], False))
        except (TimeoutError, OSError, websockets.WebSocketException) as e:
            raise await self._send_failed(e) from None

    async def finish(self) -> str:
        """Final text ("" = no speech). The connection is closed whatever happens."""
        try:
            if self._failure is not None or self._closed or self._finishing:
                raise self._error()
            self._finishing = True
            self._reschedule(self._final_timeout)
            try:
                await self._send(encode_audio(bytes(LAST_CHUNK_BYTES), True))
            except (TimeoutError, OSError, websockets.WebSocketException):
                pass  # the reader reports the reason (closed, error frame, or timeout)
            await self._reader
            if self._failure is not None or self._final is None:
                raise self._error()
            logger.info(
                "asr realtime done ms=%d audio_s=%.2f partials=%d empty=%s connect_id=%s logid=%s",
                self._ms(), len(self._audio) / (SAMPLE_RATE * 2), self._partials, not self._final,
                self._connect_id, self._logid,
            )
            self._release(None)
            return self._final
        finally:
            await self._close()

    async def abort(self) -> None:
        await self._close()


def volc_stream_factory(
    settings: Settings,
    uid: str,
    connect=ws_connect,
    *,
    gate: AsrGate | None = None,
    open_timeout: float = OPEN_TIMEOUT,
    idle_timeout: float = IDLE_TIMEOUT,
    final_timeout: float = FINAL_TIMEOUT,
) -> RecognizerFactory:
    """Factory for `VolcStreamRecognizer`. Every failure to start (missing key → config;
    gate busy/breaker open, handshake, request, first response → auth/upstream) is raised when
    the factory is called, so the caller can degrade to the buffered recognizer.
    App callers pass `gate=shared_asr_gate(app.state, settings)` so calls and the upload
    endpoint share one concurrency cap and breaker; without it the factory has its own gate."""
    if gate is None:
        gate = AsrGate(settings.asr_stream_max_concurrency)

    async def factory(on_partial: PartialCallback) -> VolcStreamRecognizer:
        key = settings.asr_stream_key
        if not key:
            raise AsrError("config")
        skip = await gate.try_enter()
        if skip is not None:
            logger.warning("asr realtime skipped reason=%s", skip)
            raise AsrError("upstream")
        connect_id = str(uuid.uuid4())
        headers = {
            "X-Api-Key": key,
            "X-Api-Resource-Id": settings.asr_stream_resource_id,
            "X-Api-Connect-Id": connect_id,
        }
        started = time.perf_counter()
        ws = None
        logid = ""
        failure: AsrStreamError | None = None
        try:
            async with asyncio.timeout(open_timeout):
                ws = await connect(
                    settings.asr_realtime_url,
                    additional_headers=headers,
                    open_timeout=open_timeout,
                    max_size=MAX_MESSAGE_BYTES,
                    close_timeout=CLOSE_TIMEOUT,
                    logger=_ws_logger,
                )
                logid = _logid(ws.response.headers)
                await ws.send(encode_full_request(_request_payload(uid)))
                first = decode_frame(await ws.recv())
            if first.msg_type == MSG_ERROR:
                failure = _error_from(first)
            elif first.last:
                failure = AsrStreamError("protocol", "final result before any audio")
        except AsrStreamError as e:
            failure = e
        except TimeoutError:
            failure = AsrStreamError("timeout", "open")
        except websockets.InvalidStatus as e:
            status = e.response.status_code
            failure = AsrStreamError("auth" if status in AUTH_STATUSES else "upstream", f"http={status}")
            logid = _logid(e.response.headers)
        except (OSError, websockets.WebSocketException) as e:
            failure = AsrStreamError("upstream", type(e).__name__)
        except Exception as e:  # noqa: BLE001
            failure = AsrStreamError("protocol", f"unexpected {type(e).__name__}")
        except BaseException:  # cancelled while starting: release everything, then propagate
            try:
                if ws is not None:
                    await ws.close()
            finally:  # even if cancelled again during the close
                gate.leave("aborted")
            raise
        if failure is not None:
            try:
                if ws is not None:
                    await ws.close()
            finally:  # a cancellation during the close must not leak the shared slot
                gate.leave(failure.kind)
            logger.warning(
                "asr realtime start failed kind=%s detail=%s ms=%d connect_id=%s logid=%s",
                failure.kind, failure.detail, round((time.perf_counter() - started) * 1000), connect_id, logid,
            )
            raise _map_stream(failure.kind) from None
        return VolcStreamRecognizer(
            ws, on_partial, gate,
            connect_id=connect_id, logid=logid, idle_timeout=idle_timeout, final_timeout=final_timeout,
        )

    return factory
