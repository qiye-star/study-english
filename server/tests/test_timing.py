import logging

import httpx
import pytest

from app.core.timing import Stopwatch, log_timing

ARK = "https://ark.test/api/v3/chat/completions"
CHAT = {
    "upstream_whisper_mode": "chat",
    "upstream_whisper_base_url": "https://ark.test/api/v3",
    "upstream_whisper_key": "ark-secret",
    "upstream_whisper_model": "doubao-seed-2-0-lite-260428",
}
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 20


def test_log_timing_format_is_sorted_and_numeric(caplog):
    caplog.set_level(logging.INFO, logger="app.timing")
    log_timing("stt_chat", status=200, ms=12.6, audio_bytes=44)
    assert caplog.messages == ["timing event=stt_chat audio_bytes=44 ms=13 status=200"]


def test_log_timing_never_writes_free_text(caplog):
    caplog.set_level(logging.INFO, logger="app.timing")
    log_timing("tts_volcengine", model="seed-tts-2.0", text="hello world, secret")
    assert caplog.messages == ["timing event=tts_volcengine model=seed-tts-2.0 text=?"]


def test_stopwatch_uses_the_injected_clock():
    ticks = iter([1.0, 1.25])
    assert Stopwatch(clock=lambda: next(ticks)).ms() == 250


@pytest.mark.parametrize("settings_overrides", [CHAT], indirect=True)
async def test_chat_transcription_logs_timing_without_text(client, auth_headers, respx_mock, caplog):
    caplog.set_level(logging.INFO, logger="app.timing")
    respx_mock.post(ARK).mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "secret words"}}]})
    )
    r = await client.post(
        "/api/ai/audio/transcriptions", files={"file": ("a.wav", WAV, "audio/wav")}, headers=auth_headers
    )
    assert r.status_code == 200
    lines = [m for m in caplog.messages if m.startswith("timing event=stt_chat")]
    assert len(lines) == 1 and "audio_bytes=36" in lines[0] and "status=200" in lines[0]
    assert "secret" not in " ".join(caplog.messages)


def test_log_timing_is_nan_and_inf_safe(caplog):
    caplog.set_level(logging.INFO, logger="app.timing")
    log_timing("x", a=float("nan"), b=float("inf"), c=True)
    assert caplog.messages == ["timing event=x a=? b=? c=true"]


@pytest.mark.parametrize("settings_overrides", [CHAT], indirect=True)
async def test_chat_transcription_transport_error_logs_status_zero(client, auth_headers, respx_mock, caplog):
    caplog.set_level(logging.INFO, logger="app.timing")
    respx_mock.post(ARK).mock(side_effect=httpx.ConnectError("boom"))
    r = await client.post(
        "/api/ai/audio/transcriptions", files={"file": ("a.wav", WAV, "audio/wav")}, headers=auth_headers
    )
    assert r.status_code == 502
    lines = [m for m in caplog.messages if m.startswith("timing event=stt_chat")]
    assert len(lines) == 1 and "status=0" in lines[0]


def _wav16(frames=16000):
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x02\x00" * frames)
    return buf.getvalue()


@pytest.mark.parametrize("settings_overrides", [{**CHAT, "upstream_asr_mode": "volc_stream"}], indirect=True)
@pytest.mark.parametrize("fail", [False, True])
async def test_volc_stream_timing_line(client, auth_headers, respx_mock, monkeypatch, caplog, fail):
    from app.speech.asr_stream import AsrStreamError

    async def fake(settings, pcm, uid="server"):
        if fail:
            raise AsrStreamError("upstream", "x")
        return "secret words"

    monkeypatch.setattr("app.routers.ai_audio.transcribe_pcm", fake)
    respx_mock.post(ARK).mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "secret words"}}]})
    )
    caplog.set_level(logging.INFO, logger="app.timing")
    r = await client.post(
        "/api/ai/audio/transcriptions", files={"file": ("a.wav", _wav16(), "audio/wav")}, headers=auth_headers
    )
    assert r.status_code == 200
    lines = [m for m in caplog.messages if m.startswith("timing event=stt_volc_stream")]
    assert len(lines) == 1
    assert "audio_bytes=32000" in lines[0] and f"status={0 if fail else 200}" in lines[0]
    assert "secret" not in " ".join(caplog.messages)


TTS_URL = "https://volc.test/api/v3/tts/unidirectional"
TTS = {
    "volcengine_tts_key": "volc-secret",
    "volcengine_tts_url": TTS_URL,
    "tts_models": "openai/tts-1,azure/speech,volcengine/seed-tts-2.0",
}


@pytest.mark.parametrize("settings_overrides", [TTS], indirect=True)
@pytest.mark.parametrize("ok", [True, False])
async def test_tts_volcengine_timing_line(client, auth_headers, respx_mock, caplog, ok):
    import base64
    import json

    body = b"\n".join(
        [
            json.dumps({"code": 0, "message": "", "data": base64.b64encode(b"ID3aaa").decode()}).encode(),
            json.dumps({"code": 20000000, "message": "ok", "data": None}).encode(),
        ]
    )
    respx_mock.post(TTS_URL).mock(
        return_value=httpx.Response(200, content=body) if ok else httpx.Response(500, content=b"{}")
    )
    caplog.set_level(logging.INFO, logger="app.timing")
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "secret hello", "model": "volcengine/seed-tts-2.0", "voice": "en_female_dacey_uranus_bigtts"},
        headers=auth_headers,
    )
    assert r.status_code == (200 if ok else 502)
    lines = [m for m in caplog.messages if m.startswith("timing event=tts_volcengine")]
    assert len(lines) == 1
    assert "chars=12" in lines[0] and "stream=false" in lines[0] and f"status={200 if ok else 0}" in lines[0]
    assert "secret" not in " ".join(caplog.messages)
