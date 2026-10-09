import logging

import pytest

from app.rooms import audio
from tests.fixtures.audio import wav_bytes


def test_inspect_wav_accepts_16k_mono_and_measures_duration():
    info = audio.inspect_wav(wav_bytes(2.5), min_ms=500, max_ms=60_000)
    assert info.duration_ms == 2500 and len(info.pcm) == 2500 * 32


@pytest.mark.parametrize("data,code", [
    (wav_bytes(1, rate=44100), "bad_audio"),
    (wav_bytes(1, channels=2), "bad_audio"),
    (b"ID3not-a-wav", "bad_audio"),
    (b"", "bad_audio"),
    (wav_bytes(0.3), "too_short"),
    (wav_bytes(61), "too_long"),
], ids=["44k", "stereo", "id3", "empty", "short", "long"])
def test_inspect_wav_rejects(data, code):
    with pytest.raises(audio.AudioError) as e:
        audio.inspect_wav(data, min_ms=500, max_ms=60_000)
    assert e.value.code == code


def test_inspect_wav_allows_half_a_second_over_the_cap():
    assert audio.inspect_wav(wav_bytes(60.4), min_ms=500, max_ms=60_000).duration_ms == 60_400


def test_mp3_is_about_a_tenth_of_wav():
    wav = wav_bytes(10)
    pcm = audio.inspect_wav(wav, min_ms=500, max_ms=60_000).pcm
    data, fmt = audio.stored_audio(pcm, "mp3")
    assert fmt == "mp3" and data[0] == 0xFF and 25_000 < len(data) < 40_000 and len(wav) > 300_000
    assert audio.stored_audio(pcm, "wav") == (wav, "wav")  # a canonical WAV of the same samples


def test_mp3_encoding_failure_falls_back_to_wav(monkeypatch, caplog):
    def broken(_pcm):
        raise RuntimeError("no encoder")

    monkeypatch.setattr(audio, "encode_mp3", broken)
    wav = wav_bytes(1)
    with caplog.at_level(logging.DEBUG, logger="app"):
        assert audio.stored_audio(audio.inspect_wav(wav, min_ms=500, max_ms=60_000).pcm, "mp3") == (wav, "wav")
    assert "RuntimeError" in caplog.text and "no encoder" not in caplog.text


def test_paths_stay_inside_the_data_dir(tmp_path):
    rel = audio.audio_relpath("r1", "m1", "mp3")
    assert rel == "room_audio/r1/m1.mp3" and audio.staging_relpath("m1") == "room_audio/_staging/m1.wav"
    assert not rel.startswith("recordings/")  # R2-18: the orphan-recordings tool must never see room audio
    audio.write_file(tmp_path, rel, b"abc")
    assert audio.read_file(tmp_path, rel) == b"abc"
    audio.delete_file(tmp_path, rel)
    audio.delete_file(tmp_path, rel)  # idempotent
    with pytest.raises(ValueError):
        audio.write_file(tmp_path, "../escape.mp3", b"x")
    with pytest.raises(ValueError):
        audio.read_file(tmp_path, "../escape.mp3")
