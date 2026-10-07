import pytest
from pydantic import ValidationError

from tests.conftest import make_settings

VOLC = {
    "volcengine_tts_key": "volc-secret",
    "tts_models": "openai/tts-1,volcengine/seed-tts-2.0",
}


def test_defaults_are_conservative():
    s = make_settings()
    assert s.realtime_enabled is False
    assert s.asr_stream_enabled is False  # upstream_asr_mode 默认 chat
    assert (s.realtime_max_minutes, s.realtime_idle_timeout_seconds) == (10, 60)
    assert (s.realtime_max_sessions, s.realtime_ticket_ttl_seconds) == (5, 60)
    assert s.stt_max_tokens == 512
    assert s.stt_disable_thinking is True
    assert s.realtime_llm_disable_thinking is True
    assert s.realtime_tts_sample_rate == 24000
    assert s.realtime_tts_model == "volcengine/seed-tts-2.0"
    assert s.realtime_asr_mode == "buffered"
    assert s.asr_realtime_url.endswith("/sauc/bigmodel_async")


def test_existing_asr_fields_are_untouched():
    s = make_settings()
    assert s.asr_stream_url.endswith("/sauc/bigmodel_nostream")
    assert s.asr_stream_resource_id == "volc.bigasr.sauc.duration"


def test_realtime_asr_mode_is_restricted():
    assert make_settings(realtime_asr_mode="stream").realtime_asr_mode == "stream"
    with pytest.raises(ValidationError):
        make_settings(realtime_asr_mode="bogus")


def test_asr_stream_key_falls_back_to_the_tts_key():
    assert make_settings(**VOLC).asr_stream_key == "volc-secret"
    assert make_settings(**VOLC, volcengine_asr_key="own").asr_stream_key == "own"


def test_realtime_available_needs_every_upstream():
    assert make_settings(**VOLC).realtime_available is False  # 未开启
    assert make_settings(**VOLC, realtime_enabled=True).realtime_available is True
    assert make_settings(realtime_enabled=True).realtime_available is False  # 没有火山 TTS
    assert make_settings(**VOLC, realtime_enabled=True, upstream_llm_base_url="").realtime_available is False
    assert make_settings(**VOLC, realtime_enabled=True, upstream_whisper_base_url="").realtime_available is False
    assert make_settings(**VOLC, realtime_enabled=True, upstream_whisper_base_url="", upstream_asr_mode="volc_stream").realtime_available is True


@pytest.mark.parametrize("field,value", [
    ("realtime_max_minutes", 0), ("realtime_max_minutes", 61),
    ("realtime_idle_timeout_seconds", 5), ("realtime_max_sessions", 0), ("realtime_ticket_ttl_seconds", 301),
])
def test_limits_are_bounded(field, value):
    with pytest.raises(ValidationError):
        make_settings(**{field: value})


def test_realtime_available_matches_the_recognizer_corners():
    # whisper URL in chat mode without a model is not a usable transcription path (review 4.1-m2 case 1)
    assert make_settings(**VOLC, realtime_enabled=True, upstream_whisper_mode="chat").realtime_available is False
    assert make_settings(**VOLC, realtime_enabled=True, upstream_whisper_mode="chat",
                         upstream_whisper_model="m").realtime_available is True
    # stream recognition alone is enough, whatever the upload path (case 2)
    assert make_settings(**VOLC, realtime_enabled=True, realtime_asr_mode="stream",
                         upstream_whisper_base_url="").realtime_available is True
