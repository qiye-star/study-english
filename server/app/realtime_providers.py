"""Real upstream adapters for realtime calls (plan Task 4.4): LLM stream, TTS stream,
recognizer selection and message storage. They implement the types of `app.realtime_session`.

- LLM: OpenAI-compatible streaming chat completions (DeepSeek etc.) through the existing
  `UPSTREAM_LLM_*` settings; the model must be in `LLM_MODELS` (else the default),
  `max_tokens = min(LLM_MAX_TOKENS, 600)`. Any non-200, network error, error event or truncated
  stream → `LlmError`.
- TTS: Volcengine `synthesize_stream` as raw PCM16LE at `REALTIME_TTS_SAMPLE_RATE`; chunks are
  re-cut on whole samples (even byte counts); `VolcengineError` → `TtsError` (R6).
- Recognizers: chosen by `effective_realtime_asr(settings)` (R25) — the same helper that
  `GET /api/realtime/config` reports — and built through `asr.realtime_factory` with the Task 1.6
  `volc_stream_factory` (R21). A stream recognizer that fails to open raises, and the session
  degrades to the buffered fallback (R3).
- Messages: `DbMessageStore`, same rules as `POST /api/conversations/{id}/messages` (R13).

Both streams are async generators that close their upstream (HTTP response / inner generator)
when they are closed or cancelled. Logs carry kinds and status codes only — never prompts,
replies, transcripts or keys.
"""
import contextlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.asr import (
    AsrError,
    RecognizerFactory,
    Transcribe,
    _fallback_configured,
    _map_stream,
    buffered_factory,
    realtime_factory,
)
from app.asr_realtime import volc_stream_factory
from app.asr_stream import AsrGate, AsrStreamError, transcribe_pcm, wav_to_pcm
from app.config import Settings
from app.models import Conversation, Message, utcnow
from app.realtime_asr import RealtimeAsr, effective_realtime_asr
from app.realtime_session import ConversationGoneError, LlmError, LlmStream, MessageLimitError, TtsError, TtsStream
from app.volcengine import VolcengineError, synthesize_stream

logger = logging.getLogger(__name__)

REALTIME_MAX_TOKENS = 600
MAX_CONTENT = 20000  # same cap as `MessageIn.content`
LLM_TIMEOUT = httpx.Timeout(60.0, connect=10.0)


# ---- LLM ----

def openai_llm_stream(http: httpx.AsyncClient, settings: Settings, model: str, temperature: float) -> LlmStream:
    chosen = model if model in settings.llm_model_list else settings.default_llm_model
    max_tokens = min(settings.llm_max_tokens, REALTIME_MAX_TOKENS)
    temperature = min(max(float(temperature), 0.0), 2.0)

    async def stream(messages: list[dict]):
        if not settings.upstream_llm_base_url:
            logger.warning("Realtime LLM upstream is not configured")
            raise LlmError()
        url = settings.upstream_llm_base_url.rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {settings.upstream_llm_key}", "Content-Type": "application/json"}
        body = {"model": chosen, "messages": messages, "temperature": temperature, "stream": True, "max_tokens": max_tokens}
        try:
            response = await http.send(
                http.build_request("POST", url, json=body, headers=headers, timeout=LLM_TIMEOUT), stream=True)
        except httpx.HTTPError as e:
            logger.warning("Realtime LLM request failed: %s", type(e).__name__)
            raise LlmError() from None
        try:
            if response.status_code != 200:
                logger.warning("Realtime LLM HTTP %s", response.status_code)
                raise LlmError()
            finished = False
            async for line in response.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue  # blank separators, SSE comments (keep-alive), event:/id: fields
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    event = json.loads(data)
                except ValueError:
                    continue
                if not isinstance(event, dict):
                    continue
                if event.get("error"):
                    logger.warning("Realtime LLM error event")
                    raise LlmError()
                choices = event.get("choices")
                choice = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
                if choice.get("finish_reason"):
                    finished = True
                delta = choice.get("delta")
                content = delta.get("content") if isinstance(delta, dict) else None  # reasoning_content is skipped
                if isinstance(content, str) and content:
                    yield content
            if not finished:
                logger.warning("Realtime LLM stream ended early")
                raise LlmError()
        except httpx.HTTPError as e:
            logger.warning("Realtime LLM stream failed: %s", type(e).__name__)
            raise LlmError() from None
        finally:
            await response.aclose()

    return stream


# ---- TTS ----

def volc_tts_stream(http: httpx.AsyncClient, settings: Settings, voice: str, uid: str) -> TtsStream:
    resource = settings.realtime_tts_model.removeprefix("volcengine/")

    async def stream(text: str):
        carry = b""
        chunks = synthesize_stream(
            http, settings.volcengine_tts_url, settings.volcengine_tts_key, resource, text, voice, uid,
            audio_format="pcm", sample_rate=settings.realtime_tts_sample_rate,
        )
        try:
            async with contextlib.aclosing(chunks):
                async for chunk in chunks:
                    data = carry + chunk
                    cut = len(data) - len(data) % 2
                    carry = data[cut:]
                    if cut:
                        yield data[:cut]
        except VolcengineError as e:
            logger.warning("Realtime TTS failed kind=%s", e.kind)
            raise TtsError() from None
        if carry:
            logger.warning("Realtime TTS ended on half a sample; dropped 1 byte")

    return stream


# ---- recognizers ----

def _stream_only_transcriber(settings: Settings, gate: AsrGate, uid: str) -> Transcribe:
    """Buffered transcription when the upload path is `volc_stream` with no chat/Whisper fallback.
    Same gate and error mapping as `asr.make_transcriber`, except that an empty result (silence)
    is "" (no speech) instead of an upstream error — a silent utterance must not become `asr_failed`."""

    async def transcribe(wav: bytes) -> str:
        pcm = wav_to_pcm(wav)
        if pcm is None:
            raise AsrError("upstream")
        skip = await gate.try_enter()
        if skip is not None:
            logger.warning("realtime buffered asr skipped reason=%s", skip)
            raise AsrError("upstream")
        kind = None
        try:
            return await transcribe_pcm(settings, pcm, uid)
        except AsrStreamError as e:
            if e.kind == "empty":
                return ""
            kind = e.kind
            logger.warning("realtime buffered asr failed kind=%s connect_id=%s logid=%s", e.kind, e.connect_id, e.logid)
            raise _map_stream(e.kind) from None
        finally:
            gate.leave(kind)

    return transcribe


def _buffered(http: httpx.AsyncClient, settings: Settings, gate: AsrGate | None, uid: str) -> RecognizerFactory:
    """The buffered recognizer; `AsrError("config")` when no transcription path is configured."""
    if settings.asr_stream_enabled and settings.asr_stream_key and not _fallback_configured(settings):
        if gate is None:
            gate = AsrGate(settings.asr_stream_max_concurrency)
        return buffered_factory(_stream_only_transcriber(settings, gate, uid))
    buffered = settings.model_copy(update={"realtime_asr_mode": "buffered"})
    return realtime_factory(http, buffered, "en", gate=gate, uid=uid)


def make_recognizers(
    http: httpx.AsyncClient, settings: Settings, uid: str, *, gate: AsrGate | None = None,
) -> tuple[RecognizerFactory, RecognizerFactory | None, RealtimeAsr]:
    """(primary, fallback, asr_mode). `asr_mode` is `effective_realtime_asr(settings)` — exactly what
    the config endpoint reports. App callers pass `gate=shared_asr_gate(app.state, settings)`.
    Raises `AsrError("config")` when there is no recognizer at all (the router closes 4502)."""
    mode = effective_realtime_asr(settings)
    if mode == "stream":
        primary = realtime_factory(http, settings, "en", gate=gate, uid=uid,
                                   stream_factory=volc_stream_factory(settings, uid, gate=gate))
        try:
            fallback = _buffered(http, settings, gate, uid)
        except AsrError:
            fallback = None
        return primary, fallback, mode
    return _buffered(http, settings, gate, uid), None, mode


# ---- messages ----

def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class DbMessageStore:
    """`MessageStore` over the existing tables. The conversation is re-checked on every call, so a
    conversation deleted (or never owned) during the call raises `ConversationGoneError`."""

    def __init__(self, sessionmaker, user_id: int, conversation_id: str, max_messages: int):
        self._sm = sessionmaker
        self._user_id = user_id
        self._conversation_id = conversation_id
        self._max = max_messages

    async def _conversation(self, session) -> Conversation:
        conversation = await session.scalar(select(Conversation).where(
            Conversation.id == self._conversation_id, Conversation.user_id == self._user_id))
        if conversation is None:
            raise ConversationGoneError()
        return conversation

    async def _add(self, role: str, text: str) -> str:
        async with self._sm() as session:
            conversation = await self._conversation(session)
            count = await session.scalar(
                select(func.count()).select_from(Message).where(Message.conversation_id == conversation.id))
            if count + 1 > self._max:
                raise MessageLimitError()
            last = await session.scalar(
                select(func.max(Message.created_at)).where(Message.conversation_id == conversation.id))
            created = utcnow()
            if last is not None and _as_utc(last) >= created:
                created = _as_utc(last) + timedelta(microseconds=1)
            row = Message(id=str(uuid.uuid4()), conversation_id=conversation.id, role=role,
                          content=text[:MAX_CONTENT], created_at=created)
            session.add(row)
            conversation.updated_at = created
            try:
                await session.commit()
            except IntegrityError:
                # deleted between the check and the insert (FK violation)
                await session.rollback()
                raise ConversationGoneError() from None
            return row.id

    async def add_user(self, text: str) -> str:
        return await self._add("user", text)

    async def add_assistant(self, text: str) -> str:
        return await self._add("assistant", text)

    async def history(self, limit: int) -> list[dict]:
        async with self._sm() as session:
            conversation = await self._conversation(session)
            if limit <= 0:
                return []
            rows = (await session.execute(
                select(Message.role, Message.content)
                .where(Message.conversation_id == conversation.id, Message.role.in_(("user", "assistant")))
                .order_by(Message.created_at.desc(), Message.id.desc())
                .limit(limit)
            )).all()
        return [{"role": role, "content": content} for role, content in reversed(rows)]
