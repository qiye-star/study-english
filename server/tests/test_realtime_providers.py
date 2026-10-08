import asyncio
import itertools
import json
import logging

import httpx
import pytest

from app.speech import asr
from app.realtime import realtime_providers as providers
from app.speech.asr import AsrError, BufferedRecognizer
from app.speech.asr_stream import AsrGate, AsrStreamError
from app.speech.realtime_asr import effective_realtime_asr
from app.realtime.realtime_providers import (
    REALTIME_MAX_TOKENS,
    DbMessageStore,
    make_recognizers,
    openai_llm_stream,
    volc_tts_stream,
)
from app.realtime.realtime_session import ConversationGoneError, LlmError, MessageLimitError, TtsError
from app.routers.realtime import realtime_config
from app.providers.volcengine import VolcengineError
from tests.conftest import make_settings

LLM = "https://llm.test/v1/chat/completions"


def sse(*events: str) -> bytes:
    return "".join(f"data: {e}\n\n" for e in events).encode()


def delta(text: str) -> str:
    return json.dumps({"choices": [{"delta": {"content": text}}]})


async def collect(gen):
    return [x async for x in gen]


class Pieces(httpx.AsyncByteStream):
    """A response body delivered in the given network pieces; records whether it was closed."""

    def __init__(self, pieces: list[bytes], gate: asyncio.Event | None = None):
        self.pieces = pieces
        self.gate = gate
        self.closed = False

    async def __aiter__(self):
        for i, piece in enumerate(self.pieces):
            if i and self.gate is not None:
                await self.gate.wait()
            yield piece

    async def aclose(self):
        self.closed = True


# ---- LLM ----

async def test_llm_stream_parses_deltas_and_clamps(respx_mock):
    route = respx_mock.post(LLM).mock(return_value=httpx.Response(200, content=sse(
        json.dumps({"choices": [{"delta": {"role": "assistant"}}]}),
        delta("Hi"),
        ": keep-alive",
        delta(" there."),
        "[DONE]",
    )))
    async with httpx.AsyncClient() as http:
        stream = openai_llm_stream(http, make_settings(llm_max_tokens=4096), "not-a-model", 0.5)
        assert await collect(stream([{"role": "user", "content": "x"}])) == ["Hi", " there."]
    body = json.loads(route.calls.last.request.content)
    assert body["model"] == "gpt-4o" and body["stream"] is True and body["max_tokens"] == 600 and body["temperature"] == 0.5
    assert body["messages"] == [{"role": "user", "content": "x"}]
    assert route.calls.last.request.headers["authorization"] == "Bearer llm-secret"
    assert REALTIME_MAX_TOKENS == 600


async def test_llm_stream_keeps_allowed_model_and_lower_token_cap(respx_mock):
    route = respx_mock.post(LLM).mock(return_value=httpx.Response(200, content=sse(delta("ok"), "[DONE]")))
    async with httpx.AsyncClient() as http:
        stream = openai_llm_stream(http, make_settings(llm_max_tokens=300), "gpt-4o-mini", 0.7)
        assert await collect(stream([])) == ["ok"]
    body = json.loads(route.calls.last.request.content)
    assert body["model"] == "gpt-4o-mini" and body["max_tokens"] == 300


async def test_llm_stream_disables_thinking_when_forced(respx_mock):
    # Review 4.4-I1: DeepSeek v4 models think by default (real upstream, 2026-10-07: 89-116 reasoning tokens
    # before the first spoken word); `thinking: disabled` was accepted (HTTP 200) and removed them.
    route = respx_mock.post(LLM).mock(return_value=httpx.Response(200, content=sse(delta("ok"), "[DONE]")))
    async with httpx.AsyncClient() as http:
        await collect(openai_llm_stream(http, make_settings(upstream_llm_base_url="https://llm.test/v1",
                                                            realtime_llm_disable_thinking="true"), "gpt-4o", 0.7)([]))
        assert json.loads(route.calls.last.request.content)["thinking"] == {"type": "disabled"}
        await collect(openai_llm_stream(http, make_settings(realtime_llm_disable_thinking=False), "gpt-4o", 0.7)([]))
        assert "thinking" not in json.loads(route.calls.last.request.content)


async def test_llm_stream_handles_events_split_across_network_chunks(respx_mock):
    raw = sse(delta("Hel"), json.dumps({"choices": [{"delta": {"reasoning_content": "hmm"}}]}), delta("lo é"), "[DONE]")
    pieces = [raw[i:i + 7] for i in range(0, len(raw), 7)]
    respx_mock.post(LLM).mock(return_value=httpx.Response(200, stream=Pieces(pieces)))
    async with httpx.AsyncClient() as http:
        assert "".join(await collect(openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([]))) == "Hello é"


async def test_llm_stream_accepts_crlf_and_no_space_after_colon(respx_mock):
    raw = ("data:" + delta("a") + "\r\n\r\n" + "data: " + delta("b") + "\r\n\r\ndata: [DONE]\r\n\r\n").encode()
    respx_mock.post(LLM).mock(return_value=httpx.Response(200, content=raw))
    async with httpx.AsyncClient() as http:
        assert await collect(openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([])) == ["a", "b"]


async def test_llm_stream_finish_reason_without_done_is_a_normal_end(respx_mock):
    raw = sse(delta("Hi."), json.dumps({"choices": [{"delta": {}, "finish_reason": "stop"}]}))
    respx_mock.post(LLM).mock(return_value=httpx.Response(200, content=raw))
    async with httpx.AsyncClient() as http:
        assert await collect(openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([])) == ["Hi."]


def finish(reason: str, text: str | None = None) -> str:
    return json.dumps({"choices": [{"delta": {"content": text} if text else {}, "finish_reason": reason}]})


@pytest.mark.parametrize("raw", [
    sse(json.dumps({"choices": [{"delta": {"reasoning_content": "hmm"}}]}), finish("stop"), "[DONE]"),
    sse(json.dumps({"choices": [{"delta": {"reasoning_content": "hmm"}}]}), finish("length"), "[DONE]"),
    sse(delta(""), "[DONE]"),
])
async def test_llm_stream_without_any_content_is_an_empty_error(respx_mock, raw):
    # Review 4.4-I1: a reply with no spoken text must reach the caller as `llm_failed`, not a silent reply_done.
    respx_mock.post(LLM).mock(return_value=httpx.Response(200, content=raw))
    async with httpx.AsyncClient() as http:
        with pytest.raises(LlmError) as e:
            await collect(openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([]))
    assert e.value.args == ("empty",)


async def test_llm_stream_stops_reading_at_finish_reason_without_done(respx_mock):
    # Review 4.4-m2: a provider that sends finish_reason and then holds the connection open must not
    # delay reply_done until the read timeout.
    gate = asyncio.Event()  # never set: the second piece ([DONE]) never arrives
    body = Pieces([sse(delta("Hi"), finish("stop", " there.")), sse("[DONE]")], gate)
    respx_mock.post(LLM).mock(return_value=httpx.Response(200, stream=body))
    async with httpx.AsyncClient() as http:
        async with asyncio.timeout(2):
            assert await collect(openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([])) == ["Hi", " there."]
    assert body.closed


async def test_llm_stream_cut_at_max_tokens_ends_normally_with_a_numbers_only_warning(respx_mock, caplog):
    # Review 4.4-m3: `length` keeps what was said (saved as a normal reply) and logs the cap, never the text.
    caplog.set_level(logging.DEBUG)
    respx_mock.post(LLM).mock(return_value=httpx.Response(200, content=sse(delta("SECRET-A"), finish("length"), "[DONE]")))
    async with httpx.AsyncClient() as http:
        assert await collect(openai_llm_stream(http, make_settings(llm_max_tokens=300), "gpt-4o", 0.7)([])) == ["SECRET-A"]
    warnings = [r.getMessage() for r in caplog.records if r.name.startswith("app") and r.levelno == logging.WARNING]
    assert any("max_tokens=300" in w for w in warnings)
    assert "SECRET" not in " ".join(warnings)


@pytest.mark.parametrize("response", [
    httpx.Response(500), httpx.Response(401), httpx.Response(429), httpx.ConnectError("x"), httpx.ReadTimeout("x"),
])
async def test_llm_stream_errors(respx_mock, response):
    mock = respx_mock.post(LLM)
    mock.mock(side_effect=response) if isinstance(response, Exception) else mock.mock(return_value=response)
    async with httpx.AsyncClient() as http:
        with pytest.raises(LlmError):
            await collect(openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([]))


@pytest.mark.parametrize("raw", [
    sse(delta("Hi"), json.dumps({"error": {"message": "overloaded"}})),
    sse(delta("Hi")),  # cut off before [DONE] with nothing more
    b"",  # empty body
])
async def test_llm_stream_errors_inside_the_stream(respx_mock, raw):
    respx_mock.post(LLM).mock(return_value=httpx.Response(200, content=raw))
    async with httpx.AsyncClient() as http:
        with pytest.raises(LlmError):
            await collect(openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([]))


async def test_llm_stream_error_while_reading_is_llm_error(respx_mock):
    class Broken(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield sse(delta("Hi"))
            raise httpx.ReadError("reset")

    respx_mock.post(LLM).mock(return_value=httpx.Response(200, stream=Broken()))
    got = []
    async with httpx.AsyncClient() as http:
        with pytest.raises(LlmError):
            async for piece in openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([]):
                got.append(piece)
    assert got == ["Hi"]


async def test_llm_stream_not_configured_is_llm_error(respx_mock):
    async with httpx.AsyncClient() as http:
        with pytest.raises(LlmError):
            await collect(openai_llm_stream(http, make_settings(upstream_llm_base_url=""), "gpt-4o", 0.7)([]))
    assert not respx_mock.calls


async def test_llm_stream_closing_early_closes_the_upstream_response(respx_mock):
    gate = asyncio.Event()  # never set: the second piece never arrives
    body = Pieces([sse(delta("Hi")), sse(delta(" never"), "[DONE]")], gate)
    respx_mock.post(LLM).mock(return_value=httpx.Response(200, stream=body))
    async with httpx.AsyncClient() as http:
        gen = openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([])
        assert await anext(gen) == "Hi"
        await gen.aclose()
    assert body.closed


async def test_llm_stream_cancellation_closes_the_upstream_response(respx_mock):
    gate = asyncio.Event()
    body = Pieces([sse(delta("Hi")), sse("[DONE]")], gate)
    respx_mock.post(LLM).mock(return_value=httpx.Response(200, stream=body))
    async with httpx.AsyncClient() as http:
        gen = openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([])
        assert await anext(gen) == "Hi"
        task = asyncio.create_task(anext(gen))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await gen.aclose()
    assert body.closed


async def test_llm_stream_clamps_temperature(respx_mock):
    route = respx_mock.post(LLM).mock(return_value=httpx.Response(200, content=sse(delta("x"), "[DONE]")))
    async with httpx.AsyncClient() as http:
        await collect(openai_llm_stream(http, make_settings(), "gpt-4o", 9.0)([]))
        assert json.loads(route.calls.last.request.content)["temperature"] == 2.0
        await collect(openai_llm_stream(http, make_settings(), "gpt-4o", -1)([]))
        assert json.loads(route.calls.last.request.content)["temperature"] == 0.0


async def test_llm_stream_never_logs_prompt_or_reply(respx_mock, caplog):
    caplog.set_level(logging.DEBUG)
    respx_mock.post(LLM).mock(return_value=httpx.Response(200, content=sse(delta("SECRET-REPLY"), json.dumps({"error": "x"}))))
    async with httpx.AsyncClient() as http:
        with pytest.raises(LlmError):
            await collect(openai_llm_stream(http, make_settings(), "gpt-4o", 0.7)([{"role": "user", "content": "SECRET-PROMPT"}]))
    logged = " ".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    assert "SECRET" not in logged and "llm-secret" not in logged


# ---- TTS ----

async def test_tts_stream_keeps_pcm_samples_whole(monkeypatch):
    calls = {}

    async def fake(http, url, key, resource, text, speaker, uid, audio_format="mp3", sample_rate=24000):
        calls.update(resource=resource, audio_format=audio_format, sample_rate=sample_rate, speaker=speaker, uid=uid,
                     text=text, key=key)
        for chunk in (b"\x01\x02\x03", b"\x04", b"\x05\x06\x07"):
            yield chunk

    monkeypatch.setattr(providers, "synthesize_stream", fake)
    settings = make_settings(volcengine_tts_key="k", realtime_tts_sample_rate=24000)
    out = await collect(volc_tts_stream(None, settings, "voice_x", "1")("Hello."))
    assert out == [b"\x01\x02", b"\x03\x04", b"\x05\x06"]  # the dangling odd byte is dropped
    assert calls == {"resource": "seed-tts-2.0", "audio_format": "pcm", "sample_rate": 24000, "speaker": "voice_x",
                     "uid": "1", "text": "Hello.", "key": "k"}


async def test_tts_stream_uses_the_configured_sample_rate(monkeypatch):
    seen = {}

    async def fake(*args, audio_format="mp3", sample_rate=24000):
        seen["rate"] = sample_rate
        yield b"\x00\x00"

    monkeypatch.setattr(providers, "synthesize_stream", fake)
    await collect(volc_tts_stream(None, make_settings(volcengine_tts_key="k", realtime_tts_sample_rate=16000), "v", "1")("x"))
    assert seen["rate"] == 16000


@pytest.mark.parametrize("kind", ["upstream", "auth"])
async def test_tts_stream_maps_errors(monkeypatch, kind):
    async def broken(*args, **kwargs):
        raise VolcengineError(kind)
        yield b""

    monkeypatch.setattr(providers, "synthesize_stream", broken)
    with pytest.raises(TtsError):
        await collect(volc_tts_stream(None, make_settings(volcengine_tts_key="k"), "v", "1")("x"))


async def test_tts_stream_maps_errors_after_the_first_chunk(monkeypatch):
    async def broken(*args, **kwargs):
        yield b"\x01\x02"
        raise VolcengineError("upstream")

    monkeypatch.setattr(providers, "synthesize_stream", broken)
    got = []
    with pytest.raises(TtsError):
        async for chunk in volc_tts_stream(None, make_settings(volcengine_tts_key="k"), "v", "1")("x"):
            got.append(chunk)
    assert got == [b"\x01\x02"]


async def test_tts_stream_closing_early_closes_the_upstream_stream(monkeypatch):
    state = {"closed": False}

    async def fake(*args, **kwargs):
        try:
            yield b"\x01\x02"
            yield b"\x03\x04"
        finally:
            state["closed"] = True

    monkeypatch.setattr(providers, "synthesize_stream", fake)
    gen = volc_tts_stream(None, make_settings(volcengine_tts_key="k"), "v", "1")("x")
    assert await anext(gen) == b"\x01\x02"
    await gen.aclose()
    assert state["closed"]


async def test_tts_stream_against_the_real_parser(respx_mock):
    import base64

    url = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
    payload = "".join(json.dumps({"code": 0, "data": base64.b64encode(c).decode()}) for c in (b"\x01\x02\x03", b"\x04"))
    payload += json.dumps({"code": 20000000, "message": "ok"})
    route = respx_mock.post(url).mock(return_value=httpx.Response(200, content=payload.encode()))
    async with httpx.AsyncClient() as http:
        out = await collect(volc_tts_stream(http, make_settings(volcengine_tts_key="k"), "v", "7")("Hi."))
    assert b"".join(out) == b"\x01\x02\x03\x04" and all(len(c) % 2 == 0 for c in out)
    sent = json.loads(route.calls.last.request.content)
    assert sent["req_params"]["audio_params"] == {"format": "pcm", "sample_rate": 24000}
    assert route.calls.last.request.headers["x-api-resource-id"] == "seed-tts-2.0"


async def test_tts_stream_http_error_is_tts_error(respx_mock):
    respx_mock.post("https://openspeech.bytedance.com/api/v3/tts/unidirectional").mock(return_value=httpx.Response(401))
    async with httpx.AsyncClient() as http:
        with pytest.raises(TtsError):
            await collect(volc_tts_stream(http, make_settings(volcengine_tts_key="k"), "v", "1")("x"))


# ---- recognizers (R25, R21, R3) ----

class FakeStreamFactory:
    def __init__(self):
        self.calls = []

    def __call__(self, settings, uid, *, gate=None, **kwargs):
        self.calls.append({"uid": uid, "gate": gate})

        async def factory(on_partial):
            return "stream-recognizer"

        return factory


@pytest.fixture
def fake_stream(monkeypatch):
    fake = FakeStreamFactory()
    monkeypatch.setattr(providers, "volc_stream_factory", fake)
    return fake


async def noop(_):
    return None


async def test_recognizer_selection_defaults_to_buffered(fake_stream):
    primary, fallback, mode = make_recognizers(None, make_settings(), "1")
    assert (fallback, mode) == (None, "buffered")
    assert isinstance(await primary(noop), BufferedRecognizer)
    assert not fake_stream.calls


async def test_upload_stream_mode_alone_does_not_select_streaming(fake_stream):
    # R25: UPSTREAM_ASR_MODE affects only the upload path; the plan's draft keyed off it and was wrong.
    _, fallback, mode = make_recognizers(None, make_settings(upstream_asr_mode="volc_stream", volcengine_tts_key="k"), "1")
    assert (fallback, mode) == (None, "buffered")
    assert not fake_stream.calls


async def test_stream_mode_uses_the_realtime_factory_with_the_shared_gate(fake_stream):
    gate = AsrGate(2)
    settings = make_settings(realtime_asr_mode="stream", volcengine_asr_key="asr-k")
    primary, fallback, mode = make_recognizers(None, settings, "42", gate=gate)
    assert mode == "stream"
    assert await primary(noop) == "stream-recognizer"
    assert fake_stream.calls == [{"uid": "42", "gate": gate}]
    assert isinstance(await fallback(noop), BufferedRecognizer)


async def test_stream_mode_without_a_buffered_path_has_no_fallback(fake_stream):
    settings = make_settings(realtime_asr_mode="stream", volcengine_asr_key="asr-k", upstream_whisper_base_url="")
    _, fallback, mode = make_recognizers(None, settings, "1")
    assert (fallback, mode) == (None, "stream")


def test_nothing_configured_raises_config_error(fake_stream):
    settings = make_settings(upstream_whisper_base_url="")
    with pytest.raises(AsrError) as e:
        make_recognizers(None, settings, "1")
    assert e.value.kind == "config"


@pytest.mark.parametrize("realtime_mode,upstream_mode,asr_key,tts_key,whisper", list(itertools.product(
    ["buffered", "stream"], ["chat", "volc_stream"], ["", "asr-k"], ["", "tts-k"], ["", "https://whisper.test/v1"],
)))
async def test_config_endpoint_and_recognizers_agree(fake_stream, realtime_mode, upstream_mode, asr_key, tts_key, whisper):
    settings = make_settings(
        realtime_asr_mode=realtime_mode, upstream_asr_mode=upstream_mode, volcengine_asr_key=asr_key,
        volcengine_tts_key=tts_key, upstream_whisper_base_url=whisper,
    )
    reported = (await realtime_config(None, settings))["asr_mode"]
    assert reported == effective_realtime_asr(settings)
    try:
        primary, _, mode = make_recognizers(None, settings, "1")
    except AsrError as e:
        # Only possible when there is no recognizer at all, and then realtime is not available.
        assert e.kind == "config" and reported == "buffered" and not settings.realtime_available
        return
    assert mode == reported
    recognizer = await primary(noop)
    if reported == "stream":
        assert recognizer == "stream-recognizer"
    else:
        assert isinstance(recognizer, BufferedRecognizer) and not fake_stream.calls


@pytest.mark.parametrize("realtime_mode,upstream_mode,asr_key,whisper,whisper_mode,whisper_model", list(itertools.product(
    ["buffered", "stream"], ["chat", "volc_stream"], ["", "asr-k"], ["", "https://whisper.test/v1"],
    ["openai", "chat"], ["", "whisper-1"],
)))
async def test_realtime_available_iff_a_recognizer_can_be_built(
        fake_stream, realtime_mode, upstream_mode, asr_key, whisper, whisper_mode, whisper_model):
    # Review 4.1-m2: `realtime_available` (config + ticket endpoints) must agree with `make_recognizers`
    # when every other upstream is configured — no "enabled but every call fails" or "disabled but works".
    settings = make_settings(
        realtime_enabled=True, volcengine_tts_key="tts-k", tts_models="openai/tts-1,volcengine/seed-tts-2.0",
        realtime_asr_mode=realtime_mode, upstream_asr_mode=upstream_mode, volcengine_asr_key=asr_key,
        upstream_whisper_base_url=whisper, upstream_whisper_mode=whisper_mode, upstream_whisper_model=whisper_model,
    )
    try:
        make_recognizers(None, settings, "1")
        buildable = True
    except AsrError as e:
        assert e.kind == "config"
        buildable = False
    assert settings.realtime_available == buildable


async def test_real_stream_factory_open_failure_raises_for_the_session_to_degrade(monkeypatch):
    # The real `volc_stream_factory` (R21): a failed open raises AsrError, which the session turns into
    # `degraded` + the buffered fallback (R3, covered in test_realtime_session).
    async def refuse(*args, **kwargs):
        raise OSError("refused")

    real = providers.volc_stream_factory
    monkeypatch.setattr(providers, "volc_stream_factory",
                        lambda settings, uid, *, gate=None: real(settings, uid, refuse, gate=gate))
    settings = make_settings(realtime_asr_mode="stream", volcengine_asr_key="asr-k")
    primary, fallback, _ = make_recognizers(None, settings, "1", gate=AsrGate(1))
    with pytest.raises(AsrError):
        await primary(noop)
    assert isinstance(await fallback(noop), BufferedRecognizer)


def stream_only(**overrides):
    return make_settings(upstream_asr_mode="volc_stream", volcengine_asr_key="asr-k", upstream_whisper_base_url="",
                         **overrides)


async def test_stream_only_buffered_silence_is_no_speech(monkeypatch):
    # Review 4.4-m1: the stream-only buffered path is plain `asr.make_transcriber` (no realtime-only copy);
    # with no chat/Whisper fallback an empty stream result is "" (no speech), not `asr_failed`.
    async def empty(settings, pcm, uid="server"):
        raise AsrStreamError("empty")

    monkeypatch.setattr(asr, "transcribe_pcm", empty)
    gate = AsrGate(1)
    primary, fallback, mode = make_recognizers(None, stream_only(), "1", gate=gate)
    assert (fallback, mode) == (None, "buffered")
    recognizer = await primary(noop)
    await recognizer.send_audio(b"\x00\x00" * 1600)
    assert await recognizer.finish() == ""
    assert await gate.try_enter() is None  # the slot was released


@pytest.mark.parametrize("kind,expected", [("upstream", "upstream"), ("auth", "auth"), ("timeout", "upstream")])
async def test_stream_only_buffered_failures_are_asr_errors(monkeypatch, kind, expected):
    async def broken(settings, pcm, uid="server"):
        raise AsrStreamError(kind)

    monkeypatch.setattr(asr, "transcribe_pcm", broken)
    primary, _, _ = make_recognizers(None, stream_only(), "1")
    recognizer = await primary(noop)
    await recognizer.send_audio(b"\x01\x00" * 1600)
    with pytest.raises(AsrError) as e:
        await recognizer.finish()
    assert e.value.kind == expected


async def test_stream_only_buffered_passes_pcm_and_uid(monkeypatch):
    seen = {}

    async def ok(settings, pcm, uid="server"):
        seen.update(pcm=pcm, uid=uid)
        return "hello"

    monkeypatch.setattr(asr, "transcribe_pcm", ok)
    primary, _, _ = make_recognizers(None, stream_only(), "9")
    recognizer = await primary(noop)
    await recognizer.send_audio(b"\x01\x00" * 10)
    assert await recognizer.finish() == "hello"
    assert seen == {"pcm": b"\x01\x00" * 10, "uid": "9"}


async def test_stream_only_buffered_busy_gate_is_an_asr_error(monkeypatch):
    async def ok(settings, pcm, uid="server"):
        return "hello"

    monkeypatch.setattr(asr, "transcribe_pcm", ok)
    gate = AsrGate(1)
    assert await gate.try_enter() is None  # someone else holds the only slot
    primary, _, _ = make_recognizers(None, stream_only(), "1", gate=gate)
    recognizer = await primary(noop)
    await recognizer.send_audio(b"\x01\x00" * 10)
    with pytest.raises(AsrError):
        await recognizer.finish()


async def test_buffered_with_chat_fallback_uses_the_upload_transcriber(respx_mock):
    respx_mock.post("https://whisper.test/v1/audio/transcriptions").mock(
        return_value=httpx.Response(200, json={"text": "hello there"}))
    async with httpx.AsyncClient() as http:
        primary, _, _ = make_recognizers(http, make_settings(), "1")
        recognizer = await primary(noop)
        await recognizer.send_audio(b"\x01\x00" * 1600)
        assert await recognizer.finish() == "hello there"
    assert b"RIFF" in respx_mock.calls.last.request.content


# ---- message store (R13) ----

async def new_conversation(client, headers) -> str:
    return (await client.post("/api/conversations", json={"name": "c", "config": {}}, headers=headers)).json()["id"]


async def user_id(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])  # UserOut.id is a string


async def test_db_store_saves_in_order_and_reads_history(app, client, auth_headers):
    cid = await new_conversation(client, auth_headers)
    store = DbMessageStore(app.state.sessionmaker, await user_id(client, auth_headers), cid, max_messages=10)
    first = await store.add_user("hello")
    second = await store.add_assistant("hi there")
    assert first and second and first != second
    assert await store.history(20) == [{"role": "user", "content": "hello"}, {"role": "assistant", "content": "hi there"}]
    assert await store.history(1) == [{"role": "assistant", "content": "hi there"}]
    assert await store.history(0) == []
    listed = (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"]
    assert [(m["id"], m["role"], m["content"]) for m in listed] == [(first, "user", "hello"), (second, "assistant", "hi there")]


async def test_db_store_timestamps_strictly_increase_and_interleave_with_post(app, client, auth_headers, monkeypatch):
    from datetime import datetime, timezone

    frozen = datetime(2026, 1, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(providers, "utcnow", lambda: frozen)
    cid = await new_conversation(client, auth_headers)
    store = DbMessageStore(app.state.sessionmaker, await user_id(client, auth_headers), cid, max_messages=100)
    for i in range(5):
        await (store.add_user if i % 2 == 0 else store.add_assistant)(f"m{i}")
    r = await client.post(f"/api/conversations/{cid}/messages", json={"messages": [{"role": "user", "content": "posted"}]},
                          headers=auth_headers)
    assert r.status_code == 200
    await store.add_assistant("after")
    listed = (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"]
    assert [m["content"] for m in listed] == ["m0", "m1", "m2", "m3", "m4", "posted", "after"]
    stamps = [m["created_at"] for m in listed]
    assert len(set(stamps)) == len(stamps)
    assert (await store.history(2)) == [{"role": "user", "content": "posted"}, {"role": "assistant", "content": "after"}]
    conversations = (await client.get("/api/conversations", headers=auth_headers)).json()
    assert conversations


async def test_db_store_truncates_long_content(app, client, auth_headers):
    cid = await new_conversation(client, auth_headers)
    store = DbMessageStore(app.state.sessionmaker, await user_id(client, auth_headers), cid, max_messages=10)
    await store.add_assistant("x" * 25000)
    assert len((await store.history(1))[0]["content"]) == 20000


async def test_db_store_history_skips_other_roles(app, client, auth_headers):
    from app.models import Message

    cid = await new_conversation(client, auth_headers)
    store = DbMessageStore(app.state.sessionmaker, await user_id(client, auth_headers), cid, max_messages=10)
    await store.add_user("hello")
    async with app.state.sessionmaker() as session:
        session.add(Message(id="sys-1", conversation_id=cid, role="system", content="ignored"))
        await session.commit()
    assert await store.history(20) == [{"role": "user", "content": "hello"}]


async def test_db_store_limits_and_ownership(app, client, auth_headers):
    cid = await new_conversation(client, auth_headers)
    uid = await user_id(client, auth_headers)
    store = DbMessageStore(app.state.sessionmaker, uid, cid, max_messages=1)
    await store.add_user("one")
    with pytest.raises(MessageLimitError):
        await store.add_assistant("two")
    with pytest.raises(ConversationGoneError):
        await DbMessageStore(app.state.sessionmaker, uid + 1, cid, max_messages=10).add_user("x")
    with pytest.raises(ConversationGoneError):
        await DbMessageStore(app.state.sessionmaker, uid + 1, cid, max_messages=10).history(5)
    await client.delete(f"/api/conversations/{cid}", headers=auth_headers)
    with pytest.raises(ConversationGoneError):
        await store.history(5)
    with pytest.raises(ConversationGoneError):
        await store.add_user("x")


async def test_db_store_counts_messages_saved_through_post(app, client, auth_headers):
    cid = await new_conversation(client, auth_headers)
    r = await client.post(f"/api/conversations/{cid}/messages",
                          json={"messages": [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]},
                          headers=auth_headers)
    assert r.status_code == 200
    store = DbMessageStore(app.state.sessionmaker, await user_id(client, auth_headers), cid, max_messages=3)
    await store.add_user("c")
    with pytest.raises(MessageLimitError):
        await store.add_assistant("d")


async def test_db_store_never_logs_content(app, client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG)
    cid = await new_conversation(client, auth_headers)
    store = DbMessageStore(app.state.sessionmaker, await user_id(client, auth_headers), cid, max_messages=1)
    await store.add_user("SECRET-TEXT")
    with pytest.raises(MessageLimitError):
        await store.add_assistant("SECRET-TEXT")
    assert all("SECRET-TEXT" not in r.getMessage() for r in caplog.records if r.name.startswith("app"))
