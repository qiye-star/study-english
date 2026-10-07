"""Real upstream adapters for realtime calls (plan Task 4.4): LLM stream, TTS stream,
recognizer selection and message storage. They implement the types of `app.realtime_session`.

- LLM: OpenAI-compatible streaming chat completions (DeepSeek etc.) through the existing
  `UPSTREAM_LLM_*` settings; the model must be in `LLM_MODELS` (else the default),
  `max_tokens = min(LLM_MAX_TOKENS, 600)`, `thinking: disabled` unless `REALTIME_LLM_DISABLE_THINKING=false`. Any non-200, network error, error event or truncated
  stream → `LlmError`; a reply with no content at all → `LlmError("empty")`. Reading stops at the first
  `finish_reason`; `length` (cut at the cap) ends normally with a numbers-only warning.
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

from app.asr import AsrError, RecognizerFactory, realtime_factory
from app.asr_realtime import volc_stream_factory
from app.asr_stream import AsrGate
from app.config import Settings
from app.models import Conversation, Message, utcnow
from app.realtime_asr import RealtimeAsr, effective_realtime_asr
from app.realtime_session import ConversationGoneError, LlmError, LlmStream, MessageLimitError, TtsError, TtsStream
from app.volcengine import VolcengineError, synthesize_stream

logger = logging.getLogger(__name__)

REALTIME_MAX_TOKENS = 600
MAX_CONTENT = 20000  # same cap as `MessageIn.content`
LLM_TIMEOUT = httpx.Timeout(60.0, connect=10.0)
KNOWN_FINISH = ("stop", "length", "content_filter", "tool_calls", "done")  # logged as is; anything else as "other"


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
        if settings.realtime_llm_disable_thinking:
            body["thinking"] = {"type": "disabled"}  # reasoning would delay the first word and eat max_tokens
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
            finished = None  # finish_reason (or "done"), once seen
            spoke = False
            async for line in response.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue  # blank separators, SSE comments (keep-alive), event:/id: fields
                data = line[5:].strip()
                if data == "[DONE]":
                    finished = "done"
                    break
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
                delta = choice.get("delta")
                content = delta.get("content") if isinstance(delta, dict) else None  # reasoning_content is skipped
                if isinstance(content, str) and content:
                    spoke = True
                    yield content
                if choice.get("finish_reason"):
                    # Stop here: a provider that sends finish_reason but delays [DONE]/close must not delay reply_done.
                    finished = str(choice["finish_reason"])
                    break
            if finished is None:
                logger.warning("Realtime LLM stream ended early")
                raise LlmError()
            if not spoke:
                logger.warning("Realtime LLM reply had no content finish=%s", finished if finished in KNOWN_FINISH else "other")
                raise LlmError("empty")
            if finished == "length":
                # Cut at the token cap: what was said is kept and saved as a normal reply (no suffix).
                logger.warning("Realtime LLM reply cut at max_tokens=%d", max_tokens)
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

def _buffered(http: httpx.AsyncClient, settings: Settings, gate: AsrGate | None, uid: str) -> RecognizerFactory:
    """The buffered recognizer — the upload transcriber (`asr.make_transcriber`, which already treats an
    empty stream result as "no speech" when there is no chat/Whisper fallback); `AsrError("config")` when
    no transcription path is configured."""
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


# ---- pronunciation assessment (plan Task 4.6, R14) ----
import asyncio  # noqa: E402
import weakref  # noqa: E402

from app.assessment_store import QuotaExceeded, check_quota, save_assessment  # noqa: E402
from app.models import Assessment, User  # noqa: E402
from app.routers.speech import (  # noqa: E402
    MAX_REFERENCE_CHARS,
    TIMEOUT_BASE_SECONDS,
    TIMEOUT_CAP_SECONDS,
    _ise_entry,
    cleanup_orphan_chat_recordings,
)
from app.stt import pcm_to_wav  # noqa: E402
from app.xfyun import XfyunError, XfyunIse, XfyunNotConfigured  # noqa: E402
from app.xfyun_result import to_assessment  # noqa: E402

ASSESS_MAX_SECONDS = 60
ASSESS_MAX_BYTES = ASSESS_MAX_SECONDS * 32000  # PCM16 mono 16 kHz


class XfyunAssessor:
    """`Assessor` over Xfyun ISE. The reference is the transcript. Failures never raise (except
    cancellation): `{"status": "failed"}`. Logs carry kinds only, never transcript text."""

    def __init__(self, xfyun, sessionmaker, settings: Settings, user_id: int, save: bool,
                 lock: asyncio.Lock | None = None):
        self._xfyun = xfyun
        self._lock = lock or asyncio.Lock()
        self._sm = sessionmaker
        self._settings = settings
        self._user_id = user_id
        self._save = save

    async def assess(self, message_id: str, pcm: bytes, text: str) -> dict:
        pcm = pcm[:ASSESS_MAX_BYTES]
        pcm = pcm[: len(pcm) - len(pcm) % 2]
        reference = text.strip()[:MAX_REFERENCE_CHARS]
        if not pcm or not reference:
            return {"status": "failed"}
        duration = len(pcm) / 32000
        try:
            xml = await self._xfyun.evaluate(pcm, reference, _ise_entry("en"),
                                             timeout=min(TIMEOUT_BASE_SECONDS + duration, TIMEOUT_CAP_SECONDS))
            result = to_assessment(xml, reference)
        except (XfyunError, XfyunNotConfigured, ValueError) as e:
            logger.warning("Realtime assessment failed kind=%s", type(e).__name__)
            return {"status": "failed"}
        if not self._save:
            return {"status": "done", "result": result, "assessment_id": None}
        # The write (file + row + message link) runs as its own task and is shielded: a hangup that
        # cancels us mid-write lets it finish or roll back by itself, so no file is left without a row.
        task = asyncio.ensure_future(self._persist(message_id, pcm, reference, duration, result))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            task.add_done_callback(lambda t: t.cancelled() or t.exception())  # retrieve, never log
            raise

    async def _persist(self, message_id: str, pcm: bytes, reference: str, duration: float, result: dict) -> dict:
        wav = pcm_to_wav(pcm)
        try:
            # Quota check + save are atomic per user (the lock is shared by every assessor of this user,
            # see `make_assessor`), so concurrent utterances can't each pass the check and overshoot.
            # The upload route (`POST /api/assessments`) does not take this lock: a call and an upload at
            # the same moment can still overshoot by one recording.
            async with self._lock, self._sm() as session:
                user = await session.get(User, self._user_id)
                if user is not None:
                    await cleanup_orphan_chat_recordings(session, self._settings, user)
                try:
                    await check_quota(session, self._settings, self._user_id, len(wav))
                except QuotaExceeded:
                    return {"status": "quota", "result": result, "assessment_id": None}
                try:
                    assessment_id = await save_assessment(
                        session, self._settings, self._user_id, wav_bytes=wav, duration=duration,
                        reference=reference, language="en", source="chat", result=result)
                except OSError:
                    logger.warning("Realtime assessment recording could not be written")
                    return {"status": "done", "result": result, "assessment_id": None}
                message = await session.get(Message, message_id)
                if message is not None and message.assessment_id is None:
                    message.assessment_id = assessment_id
                    await session.commit()
            return {"status": "done", "result": result, "assessment_id": assessment_id}
        except Exception as e:
            logger.warning("Realtime assessment save failed kind=%s", type(e).__name__)
            return {"status": "failed"}


def make_assessor(app, settings: Settings, user_id: int, save: bool) -> XfyunAssessor | None:
    xfyun = getattr(app.state, "xfyun", None) or XfyunIse(
        settings.xfyun_app_id, settings.xfyun_api_key, settings.xfyun_api_secret, settings.xfyun_ws_url)
    if not xfyun.configured:
        return None
    locks = getattr(app.state, "assessment_save_locks", None)
    if locks is None:
        locks = app.state.assessment_save_locks = weakref.WeakValueDictionary()  # an entry lives while an assessor holds it
    lock = locks.get(user_id)
    if lock is None:
        lock = locks[user_id] = asyncio.Lock()
    return XfyunAssessor(xfyun, app.state.sessionmaker, settings, user_id, save, lock=lock)
