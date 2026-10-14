"""带时间的流式识别(plan 2026-10-13-library-alignment R-A1 / R-A3)。字段名与单位以 Task 0 的结果为准。"""
import logging

import pytest

from app.speech.asr_stream import AsrStreamError, parse_utterances, transcribe_pcm, transcribe_pcm_timed
from app.speech.timed import TimedText, Utterance, Word
from tests.test_asr_stream import decode_frame_request, fake, settings_for  # noqa: F401  (`fake` is a fixture)

PCM = b"\x00\x00" * 10

# The real shape seen in Task 0 (volc bigmodel_nostream): `words` are kept (plan v2 R-V1), `additions` is ignored.
REAL = {"text": "Hello, world.", "start_time": 27360, "end_time": 32550, "definite": True,
        "words": [{"text": "Hello,", "start_time": 27360, "end_time": 27900}], "additions": {"x": "y"}}


@pytest.mark.parametrize("raw, expected", [
    ({"utterances": [REAL]}, (Utterance("Hello, world.", 27360, 32550, (Word("Hello,", 27360, 27900),)),)),
    ({"utterances": [{"text": " Hello,  world. ", "start_time": 120, "end_time": 900, "definite": True}]},
     (Utterance("Hello, world.", 120, 900),)),
    ({"utterances": [{"text": "kept", "start_time": 0, "end_time": 5.4}]}, (Utterance("kept", 0, 5),)),  # no `definite`
    ({"utterances": [{"text": "unfinished", "start_time": 0, "end_time": 900, "definite": False}]}, ()),
    ({"utterances": [{"text": "x", "start_time": True, "end_time": 900}]}, ()),
    ({"utterances": [{"text": "x", "start_time": "0", "end_time": 900}]}, ()),
    ({"utterances": [{"text": "x", "start_time": None, "end_time": 900}]}, ()),
    ({"utterances": [{"text": "x", "start_time": 900, "end_time": 900}]}, ()),
    ({"utterances": [{"text": "x", "start_time": -5, "end_time": 900}]}, ()),
    ({"utterances": [{"text": "   ", "start_time": 0, "end_time": 900}]}, ()),
    ({"utterances": [{"start_time": 0, "end_time": 900}]}, ()),
    ({"utterances": ["not a dict", 7, None]}, ()),
    ({"utterances": "nope"}, ()), ({}, ()), (None, ()), ("text", ()),
])
def test_parse_utterances(raw, expected):
    assert parse_utterances(raw) == expected


async def test_only_the_timed_call_asks_for_utterances(fake):  # noqa: F811
    await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert decode_frame_request(fake.frames[0])["request"]["show_utterances"] is True
    fake.frames.clear()
    await transcribe_pcm(settings_for(fake.url), PCM)
    assert "show_utterances" not in decode_frame_request(fake.frames[0])["request"]


async def test_the_timed_result_carries_text_and_utterances(fake):  # noqa: F811
    fake.text = " Hello, world. "
    fake.utterances = [{"text": "Hello,", "start_time": 120, "end_time": 500, "definite": True},
                       {"text": "world.", "start_time": 560, "end_time": 900, "definite": True}]
    got = await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert got == TimedText("Hello, world.", (Utterance("Hello,", 120, 500), Utterance("world.", 560, 900)))


async def test_the_plain_call_still_returns_a_string_and_ignores_utterances(fake):  # noqa: F811
    fake.utterances = [{"text": "Hello, world.", "start_time": 0, "end_time": 900}]
    assert await transcribe_pcm(settings_for(fake.url), PCM) == "Hello, world."


async def test_a_reply_without_utterances_gives_an_empty_tuple(fake):  # noqa: F811
    assert await transcribe_pcm_timed(settings_for(fake.url), PCM) == TimedText("Hello, world.", ())


async def test_empty_text_is_still_the_empty_error_when_timed(fake):  # noqa: F811
    fake.text = "  "
    fake.utterances = [{"text": "x", "start_time": 0, "end_time": 900}]
    with pytest.raises(AsrStreamError) as e:
        await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert e.value.kind == "empty"


async def test_utterance_text_never_reaches_the_logs(fake, caplog):  # noqa: F811
    caplog.set_level(logging.DEBUG, logger="app")
    fake.text = "SECRET-TRANSCRIPT here."
    fake.utterances = [{"text": "SECRET-TRANSCRIPT here.", "start_time": 0, "end_time": 900}]
    await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert all("SECRET-TRANSCRIPT" not in f"{r.getMessage()} {r.args!r}" for r in caplog.records)
