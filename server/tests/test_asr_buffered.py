import asyncio
import io
import types
import wave

import httpx
import pytest

from app.speech.asr import (
    MAX_UTTERANCE_BYTES,
    AsrError,
    BufferedRecognizer,
    buffered_factory,
    make_transcriber,
    realtime_factory,
    shared_asr_gate,
)
from app.speech.asr_stream import AsrGate, AsrStreamError
from app.speech.stt import pcm_to_wav
from tests.conftest import make_settings

ARK = "https://ark.test/api/v3/chat/completions"
CHAT = {
    "upstream_whisper_mode": "chat",
    "upstream_whisper_base_url": "https://ark.test/api/v3",
    "upstream_whisper_key": "ark-secret",
    "upstream_whisper_model": "m",
}
STREAM = {**CHAT, "upstream_asr_mode": "volc_stream", "volcengine_asr_key": "asr-secret"}
NO_FALLBACK = {**STREAM, "upstream_whisper_base_url": ""}
PCM = b"\x01\x00" * 1600


class FakeTranscribe:
    def __init__(self, result="hello", error: Exception | None = None):
        self.calls: list[bytes] = []
        self.result, self.error = result, error

    async def __call__(self, wav: bytes) -> str:
        self.calls.append(wav)
        if self.error:
            raise self.error
        return self.result


def frames(wav: bytes) -> int:
    with wave.open(io.BytesIO(wav)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, 16000)
        return w.getnframes()


async def test_buffers_until_finish_and_sends_one_wav():
    t = FakeTranscribe()
    r = BufferedRecognizer(t)
    await r.send_audio(b"\x01\x00" * 800)
    await r.send_audio(b"\x01\x00" * 800)
    assert t.calls == []
    assert await r.finish() == "hello"
    assert frames(t.calls[0]) == 1600


async def test_empty_utterance_is_empty_without_upstream_call():
    t = FakeTranscribe()
    assert await BufferedRecognizer(t).finish() == ""
    assert t.calls == []


async def test_audio_beyond_sixty_seconds_is_dropped():
    t = FakeTranscribe()
    r = BufferedRecognizer(t)
    await r.send_audio(b"\x00" * (MAX_UTTERANCE_BYTES + 3200))
    await r.finish()
    assert frames(t.calls[0]) * 2 == MAX_UTTERANCE_BYTES


async def test_failure_propagates_and_abort_is_idempotent():
    r = BufferedRecognizer(FakeTranscribe(error=AsrError("upstream")))
    await r.send_audio(b"\x01\x00" * 10)
    with pytest.raises(AsrError):
        await r.finish()
    await r.abort()
    await r.abort()


async def test_abort_discards_buffered_audio():
    t = FakeTranscribe()
    r = BufferedRecognizer(t)
    await r.send_audio(PCM)
    await r.abort()
    assert await r.finish() == "" and t.calls == []


async def test_factory_never_calls_partial():
    partials: list[str] = []

    async def on_partial(text: str) -> None:
        partials.append(text)

    r = await buffered_factory(FakeTranscribe("x"))(on_partial)
    await r.send_audio(b"\x01\x00" * 10)
    assert await r.finish() == "x" and partials == []


@pytest.mark.parametrize("status,kind", [(403, "auth"), (500, "upstream")])
async def test_make_transcriber_maps_errors(respx_mock, status, kind):
    respx_mock.post(ARK).mock(return_value=httpx.Response(status, json={}))
    async with httpx.AsyncClient() as http:
        with pytest.raises(AsrError) as e:
            await make_transcriber(http, make_settings(**CHAT))(b"RIFF")
    assert e.value.kind == kind


async def test_make_transcriber_unconfigured_is_config():
    async with httpx.AsyncClient() as http:
        with pytest.raises(AsrError) as e:
            await make_transcriber(http, make_settings(**{**CHAT, "upstream_whisper_model": ""}))(b"RIFF")
    assert e.value.kind == "config"


async def test_make_transcriber_returns_text(respx_mock):
    respx_mock.post(ARK).mock(return_value=httpx.Response(200, json={"choices": [{"message": {"content": "<none>"}}]}))
    async with httpx.AsyncClient() as http:
        assert await make_transcriber(http, make_settings(**CHAT))(b"RIFF....WAVE") == ""


# ---- volc_stream first (R25), shared gate, fallback to chat/Whisper ----


@pytest.fixture
def stream(monkeypatch):
    """Fake `transcribe_pcm`: records PCM and returns/raises the queued outcomes in order."""
    state = types.SimpleNamespace(calls=[], outcomes=[])

    async def fake(settings, pcm, uid="server"):
        state.calls.append((pcm, uid))
        outcome = state.outcomes.pop(0) if state.outcomes else "streamed"
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr("app.speech.asr.transcribe_pcm", fake)
    return state


def chat_reply(respx_mock, content="from chat"):
    return respx_mock.post(ARK).mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": content}}]})
    )


async def test_volc_stream_mode_streams_pcm_first(respx_mock, stream):
    route = chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        text = await make_transcriber(http, make_settings(**STREAM), uid="7")(pcm_to_wav(PCM))
    assert text == "streamed"
    assert stream.calls == [(PCM, "7")]
    assert not route.called


@pytest.mark.parametrize("kind", ["auth", "quota", "timeout", "protocol", "upstream", "empty", "not_configured"])
async def test_volc_stream_failure_falls_back_to_chat(respx_mock, stream, kind):
    route = chat_reply(respx_mock)
    stream.outcomes = [AsrStreamError(kind)]
    async with httpx.AsyncClient() as http:
        assert await make_transcriber(http, make_settings(**STREAM))(pcm_to_wav(PCM)) == "from chat"
    assert route.called


async def test_volc_stream_fallback_keeps_no_speech_contract(respx_mock, stream):
    chat_reply(respx_mock, "<none>")
    stream.outcomes = [AsrStreamError("empty")]
    async with httpx.AsyncClient() as http:
        assert await make_transcriber(http, make_settings(**STREAM))(pcm_to_wav(PCM)) == ""


@pytest.mark.parametrize(
    "kind,expected",
    [("auth", "auth"), ("not_configured", "config"), ("quota", "upstream"),
     ("timeout", "upstream"), ("protocol", "upstream"), ("upstream", "upstream")],
)
async def test_volc_stream_failure_without_fallback_maps_like_the_endpoint(respx_mock, stream, kind, expected):
    stream.outcomes = [AsrStreamError(kind)]
    async with httpx.AsyncClient() as http:
        with pytest.raises(AsrError) as e:
            await make_transcriber(http, make_settings(**NO_FALLBACK))(pcm_to_wav(PCM))
    assert e.value.kind == expected


async def test_volc_stream_empty_without_fallback_is_no_speech(respx_mock, stream):
    """Review 1.5-I1: a well-formed stream result with no text is "no speech", not an error.
    (The upload endpoint keeps its own R4 mapping: tests/test_ai_audio_volc_stream.py.)"""
    route = chat_reply(respx_mock)
    stream.outcomes = [AsrStreamError("empty")]
    async with httpx.AsyncClient() as http:
        assert await make_transcriber(http, make_settings(**NO_FALLBACK))(pcm_to_wav(PCM)) == ""
    assert not route.called


async def test_silent_clip_through_the_buffered_realtime_recognizer_is_empty(stream):
    stream.outcomes = [AsrStreamError("empty")]
    gate = AsrGate(1)
    async with httpx.AsyncClient() as http:
        factory = realtime_factory(http, make_settings(**NO_FALLBACK, realtime_asr_mode="buffered"), gate=gate)
        r = await factory(lambda _t: None)
        assert isinstance(r, BufferedRecognizer)
        await r.send_audio(bytes(3200))
        assert await r.finish() == ""
    assert await gate.try_enter() is None  # slot released


async def test_silent_clip_through_buffered_recognizer_directly_is_empty(stream):
    stream.outcomes = [AsrStreamError("empty")]
    async with httpx.AsyncClient() as http:
        r = BufferedRecognizer(make_transcriber(http, make_settings(**NO_FALLBACK)))
        await r.send_audio(bytes(3200))
        assert await r.finish() == ""


async def test_cancelled_stream_is_neutral_for_the_breaker(monkeypatch):
    """Review 1.5-M1: a cancellation releases the slot without resetting the failure count."""
    started = asyncio.Event()

    async def hang(settings, pcm, uid="server"):
        started.set()
        await asyncio.sleep(10)

    monkeypatch.setattr("app.speech.asr.transcribe_pcm", hang)
    gate = AsrGate(1)
    gate._failures = 2
    async with httpx.AsyncClient() as http:
        task = asyncio.create_task(make_transcriber(http, make_settings(**STREAM), gate=gate)(pcm_to_wav(PCM)))
        await asyncio.wait_for(started.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert gate._failures == 2
    assert await gate.try_enter() is None


async def test_unstreamable_wav_goes_straight_to_fallback(respx_mock, stream):
    route = chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        assert await make_transcriber(http, make_settings(**STREAM))(pcm_to_wav(PCM, rate=8000)) == "from chat"
    assert stream.calls == [] and route.called


async def test_busy_gate_skips_the_stream_and_falls_back(respx_mock, stream):
    chat_reply(respx_mock)
    gate = AsrGate(1)
    assert await gate.try_enter() is None  # the only slot is taken
    async with httpx.AsyncClient() as http:
        assert await make_transcriber(http, make_settings(**STREAM), gate=gate)(pcm_to_wav(PCM)) == "from chat"
    assert stream.calls == []


async def test_busy_gate_without_fallback_is_upstream(stream):
    gate = AsrGate(1)
    await gate.try_enter()
    async with httpx.AsyncClient() as http:
        with pytest.raises(AsrError) as e:
            await make_transcriber(http, make_settings(**NO_FALLBACK), gate=gate)(pcm_to_wav(PCM))
    assert e.value.kind == "upstream" and stream.calls == []


async def test_repeated_auth_failures_trip_the_shared_breaker(respx_mock, stream):
    chat_reply(respx_mock)
    gate = AsrGate(3)
    stream.outcomes = [AsrStreamError("auth")] * 3
    async with httpx.AsyncClient() as http:
        transcribe = make_transcriber(http, make_settings(**STREAM), gate=gate)
        for _ in range(4):
            assert await transcribe(pcm_to_wav(PCM)) == "from chat"
    assert len(stream.calls) == 3  # the fourth call is skipped by the breaker
    assert await gate.try_enter() == "breaker"


async def test_gate_slot_is_released_after_each_call(stream):
    gate = AsrGate(1)
    async with httpx.AsyncClient() as http:
        transcribe = make_transcriber(http, make_settings(**STREAM), gate=gate)
        assert await transcribe(pcm_to_wav(PCM)) == "streamed"
        assert await transcribe(pcm_to_wav(PCM)) == "streamed"
    assert len(stream.calls) == 2


async def test_chat_mode_never_streams(respx_mock, stream):
    chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        assert await make_transcriber(http, make_settings(**CHAT))(pcm_to_wav(PCM)) == "from chat"
    assert stream.calls == []


def test_shared_gate_is_the_upload_endpoint_gate():
    from app.routers.ai_audio import _asr_gate

    settings = make_settings(**STREAM)
    state = types.SimpleNamespace()
    gate = shared_asr_gate(state, settings)
    assert shared_asr_gate(state, settings) is gate
    assert _asr_gate(types.SimpleNamespace(app=types.SimpleNamespace(state=state)), settings) is gate


def test_asr_stream_does_not_import_asr():
    import app.speech.asr_stream

    source = open(app.speech.asr_stream.__file__, encoding="utf-8").read()
    assert "app.speech.asr " not in source and "from app.speech.asr import" not in source and "import app.speech.asr\n" not in source


# ---- realtime recognizer selection (realtime_asr_mode) ----


async def test_realtime_buffered_mode_uses_the_buffered_recognizer(respx_mock):
    chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        factory = realtime_factory(http, make_settings(**CHAT, realtime_asr_mode="buffered"))
        r = await factory(lambda _t: None)
        assert isinstance(r, BufferedRecognizer)
        await r.send_audio(PCM)
        assert await r.finish() == "from chat"


async def test_realtime_stream_mode_uses_the_injected_stream_factory():
    made = []

    async def stream_factory(on_partial):
        made.append(on_partial)
        return BufferedRecognizer(FakeTranscribe("s"))

    async with httpx.AsyncClient() as http:
        factory = realtime_factory(
            http, make_settings(**STREAM, realtime_asr_mode="stream"), stream_factory=stream_factory
        )
    assert factory is stream_factory


@pytest.mark.parametrize(
    "overrides",
    [
        {**STREAM, "realtime_asr_mode": "stream"},  # no stream recognizer available (Task 1.6 not landed)
        {**STREAM, "realtime_asr_mode": "stream", "volcengine_asr_key": "", "volcengine_tts_key": ""},
        {**CHAT, "upstream_whisper_base_url": "", "realtime_asr_mode": "buffered"},
        {**CHAT, "upstream_whisper_model": "", "realtime_asr_mode": "buffered"},
    ],
)
async def test_realtime_unavailable_mode_is_config_error(overrides):
    async def stream_factory(on_partial):  # pragma: no cover - must not be chosen without a key
        raise AssertionError

    inject = stream_factory if overrides.get("volcengine_asr_key") == "" else None
    async with httpx.AsyncClient() as http:
        with pytest.raises(AsrError) as e:
            realtime_factory(http, make_settings(**overrides), stream_factory=inject)
    assert e.value.kind == "config"


async def test_realtime_buffered_with_stream_only_config_is_available(stream):
    async with httpx.AsyncClient() as http:
        factory = realtime_factory(http, make_settings(**NO_FALLBACK, realtime_asr_mode="buffered"))
        r = await factory(lambda _t: None)
        await r.send_audio(PCM)
        assert await r.finish() == "streamed"
