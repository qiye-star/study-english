import io
import wave

import pytest

from scripts.latency_samples import make_sample
from scripts.measure_latency import (
    DEFAULT_METRICS,
    FIRST_SENTENCE,
    REPLY_TEXT,
    TTS_CASES,
    markdown_row,
    parse_metrics,
    ratio,
    record,
    summarize,
)


def wav_bytes(seconds: float, rate: int = 16000) -> bytes:
    frames = int(seconds * rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(int(i % 100).to_bytes(2, "little", signed=True) for i in range(frames)))
    return buf.getvalue()


def duration(data: bytes) -> float:
    with wave.open(io.BytesIO(data)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, 16000)
        return w.getnframes() / w.getframerate()


@pytest.mark.parametrize("seconds", [5.0, 15.0])
def test_make_sample_trims_or_loops_to_the_exact_length(seconds):
    assert duration(make_sample(wav_bytes(11.0), seconds)) == seconds


def test_make_sample_rejects_other_formats():
    with pytest.raises(ValueError):
        make_sample(wav_bytes(1.0, rate=44100), 1.0)


def test_summarize_median_min_max():
    assert summarize([300, 100, 200, 500, 400]) == {"n": 5, "median": 300, "min": 100, "max": 500}
    assert summarize([1, 2, 3, 4])["median"] == 2.5
    with pytest.raises(ValueError):
        summarize([])


def test_ratio_and_markdown_row():
    assert ratio(2000, 900) == 0.45
    assert markdown_row("松手 → 转写出现(浏览器)", "s5", 2000, 900, "≤ 50%") == (
        "| 松手 → 转写出现(浏览器) | s5 | 2000 | 900 | 45% | ≤ 50% | 达标 |"
    )
    assert markdown_row("回复完成 → 开始出声(浏览器)", "s5", 1500, 900, "≤ 40%").endswith("| 60% | ≤ 40% | 未达标 |")
    assert markdown_row("x", "s5", None, None, "参考") == "| x | s5 | 未测 | 未测 | — | 参考 | — |"


def test_parse_metrics_defaults_and_selection():
    assert parse_metrics(None) == DEFAULT_METRICS
    assert parse_metrics("stt,tts_first_sentence_first_chunk") == ["stt", "tts_first_sentence_first_chunk"]
    with pytest.raises(ValueError):
        parse_metrics("stt,bogus")
    with pytest.raises(ValueError):
        parse_metrics("")


def test_tts_cases_cover_first_sentence_streaming():
    cases = {name: (text, stream) for name, text, stream in TTS_CASES}
    assert cases["tts_full_ms"] == (REPLY_TEXT, False)
    assert cases["tts_first_chunk_ms"] == (REPLY_TEXT, True)
    assert cases["tts_first_sentence_ms"] == (FIRST_SENTENCE, False)
    assert cases["tts_first_sentence_first_chunk_ms"] == (FIRST_SENTENCE, True)


def test_record_keeps_raw_runs_and_warmup():
    rec = record([500, 300, 100, 200], totals=[900, 700, 600, 650])
    assert rec == {"n": 3, "median": 200, "min": 100, "max": 300, "warmup": 500, "runs": [300, 100, 200],
                   "totals": [700, 600, 650], "total_median": 650}
    assert "totals" not in record([5, 1, 2])
