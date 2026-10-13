"""make_timed_transcriber:流式带时间,回落路径只给文字(R-A5)。"""
import types

import pytest

from app.speech.asr import AsrError, make_timed_transcriber
from app.speech.asr_stream import AsrGate, AsrStreamError
from app.speech.stt import pcm_to_wav
from app.speech.timed import TimedText, Utterance
from tests.conftest import make_settings
from tests.test_asr_buffered import ARK, CHAT, NO_FALLBACK, PCM, STREAM, chat_reply

TIMED = TimedText("streamed", (Utterance("streamed", 0, 500),))


@pytest.fixture
def timed_stream(monkeypatch):
    """Fake `transcribe_pcm_timed`: records PCM and returns / raises the queued outcomes in order."""
    state = types.SimpleNamespace(calls=[], outcomes=[])

    async def fake(settings, pcm, uid="server"):
        state.calls.append((pcm, uid))
        outcome = state.outcomes.pop(0) if state.outcomes else TIMED
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr("app.speech.asr.transcribe_pcm_timed", fake)
    return state


async def test_the_stream_path_returns_text_and_times(respx_mock, timed_stream):
    import httpx

    route = chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM), uid="7")(pcm_to_wav(PCM))
    assert got == TIMED and timed_stream.calls == [(PCM, "7")] and not route.called


async def test_a_stream_failure_falls_back_to_chat_without_times(respx_mock, timed_stream):
    import httpx

    timed_stream.outcomes = [AsrStreamError("upstream")]
    chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM))(pcm_to_wav(PCM))
    assert got == TimedText("from chat", ())


async def test_a_busy_gate_skips_the_stream_and_uses_the_fallback(respx_mock, timed_stream):
    import httpx

    gate = AsrGate(1)
    assert await gate.try_enter() is None  # occupy the only slot
    chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM), gate=gate)(pcm_to_wav(PCM))
    assert got == TimedText("from chat", ()) and timed_stream.calls == []


async def test_without_a_fallback_errors_map_like_the_plain_transcriber(respx_mock, timed_stream):
    import httpx

    timed_stream.outcomes = [AsrStreamError("auth"), AsrStreamError("empty")]
    async with httpx.AsyncClient() as http:
        transcribe = make_timed_transcriber(http, make_settings(**NO_FALLBACK))
        with pytest.raises(AsrError) as e:
            await transcribe(pcm_to_wav(PCM))
        assert e.value.kind == "auth"
        assert await transcribe(pcm_to_wav(PCM)) == TimedText("", ())  # "nothing heard" is not an error


async def test_without_the_stream_mode_it_is_the_plain_chat_path(respx_mock, timed_stream):
    import httpx

    chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**CHAT))(pcm_to_wav(PCM))
    assert got == TimedText("from chat", ()) and timed_stream.calls == []
