import logging

import httpx
import pytest

from app.timing import Stopwatch, log_timing

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
