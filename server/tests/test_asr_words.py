"""词级时间(plan 2026-10-14-library-alignment-v2 R-V1)与「识别为空即没有人声」(R-V12)。"""
import logging

import httpx
import pytest

from app.speech.asr import make_timed_transcriber
from app.speech.asr_stream import AsrStreamError, parse_utterances, parse_words, transcribe_pcm_timed
from app.speech.stt import pcm_to_wav
from app.speech.timed import TimedText, Utterance, Word
from tests.conftest import make_settings
from tests.test_asr_buffered import PCM as BUFFERED_PCM, STREAM, chat_reply
from tests.test_asr_stream import fake, settings_for  # noqa: F401  (`fake` is a fixture)
from tests.test_asr_timed import timed_stream  # noqa: F401  (fixture)

PCM = b"\x00\x00" * 10


@pytest.mark.parametrize("raw, expected", [
    ([{"text": "Hello,", "start_time": 120, "end_time": 480}, {"text": " world ", "start_time": 520.4, "end_time": 900}],
     (Word("Hello,", 120, 480), Word("world", 520, 900))),
    ([{"text": "uh", "start_time": 300, "end_time": 300}], (Word("uh", 300, 300),)),  # zero length: kept, judged later
    ([{"text": "x", "start_time": 500, "end_time": 400}], ()),  # inverted
    ([{"text": "x", "start_time": -1, "end_time": 400}], ()),
    ([{"text": "x", "start_time": 400, "end_time": -1}], ()),
    ([{"text": "x", "start_time": True, "end_time": 400}], ()),
    ([{"text": "x", "start_time": "0", "end_time": 400}], ()),
    ([{"text": "  ", "start_time": 0, "end_time": 400}], ()),
    ([{"start_time": 0, "end_time": 400}, "nope", 7, None], ()),
    (None, ()), ("words", ()), ({}, ()),
])
def test_parse_words(raw, expected):
    assert parse_words(raw) == expected


def test_placeholder_entries_between_real_words_are_dropped():
    """The recognizer interleaves 1-char placeholders timed -1/-1 with the real words (Task 0 follow-up)."""
    raw = [{"text": "a", "start_time": -1, "end_time": -1},  # a run may start with a placeholder
           {"text": "Hello", "start_time": 27360, "end_time": 27720},
           {"text": " ", "start_time": -1, "end_time": -1},
           {"text": "world", "start_time": 27760, "end_time": 28200},
           {"text": ",", "start_time": -1, "end_time": -1},
           {"text": "again", "start_time": 28240, "end_time": 28600},
           {"text": ".", "start_time": -1, "end_time": -1}]
    assert parse_words(raw) == (Word("Hello", 27360, 27720), Word("world", 27760, 28200), Word("again", 28240, 28600))
    utt = parse_utterances({"utterances": [{"text": "Hello world again.", "start_time": 27360, "end_time": 28600,
                                            "words": raw}]})
    assert utt[0].words == parse_words(raw) and utt[0].words[0].start_ms == utt[0].start_ms
    assert utt[0].words[-1].end_ms == utt[0].end_ms


def test_utterances_carry_their_words_in_the_same_time_base():
    raw = {"utterances": [{"text": "Hello, world.", "start_time": 27360, "end_time": 28200, "definite": True,
                           "words": [{"text": "Hello", "start_time": 27360, "end_time": 27700},
                                     {"text": "world", "start_time": 27760, "end_time": 28200}],
                           "additions": {"x": "y"}}]}
    assert parse_utterances(raw) == (Utterance("Hello, world.", 27360, 28200,
                                               (Word("Hello", 27360, 27700), Word("world", 27760, 28200))),)


async def test_the_timed_stream_result_keeps_the_words(fake):  # noqa: F811
    fake.text = "Hi there."
    fake.utterances = [{"text": "Hi there.", "start_time": 100, "end_time": 900, "definite": True,
                        "words": [{"text": "Hi", "start_time": 100, "end_time": 380},
                                  {"text": "there", "start_time": 420, "end_time": 900}]}]
    got = await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert got.utterances[0].words == (Word("Hi", 100, 380), Word("there", 420, 900))


async def test_word_text_never_reaches_the_logs(fake, caplog):  # noqa: F811
    caplog.set_level(logging.DEBUG, logger="app")
    fake.text = "SECRET-TRANSCRIPT here."
    fake.utterances = [{"text": "SECRET-TRANSCRIPT here.", "start_time": 0, "end_time": 900,
                        "words": [{"text": "SECRET-TRANSCRIPT", "start_time": 0, "end_time": 500}]}]
    await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert all("SECRET-TRANSCRIPT" not in f"{r.getMessage()} {r.args!r}" for r in caplog.records)


async def test_final_empty_means_no_speech_and_never_pays_the_fallback(respx_mock, timed_stream):  # noqa: F811
    timed_stream.outcomes = [AsrStreamError("empty")]
    route = chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM), final_empty=True)(pcm_to_wav(BUFFERED_PCM))
    assert got == TimedText("", ()) and not route.called


async def test_without_final_empty_an_empty_stream_still_falls_back(respx_mock, timed_stream):  # noqa: F811
    timed_stream.outcomes = [AsrStreamError("empty")]
    route = chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM))(pcm_to_wav(BUFFERED_PCM))
    assert got == TimedText("from chat", ()) and route.called


async def test_final_empty_does_not_swallow_real_failures(respx_mock, timed_stream):  # noqa: F811
    timed_stream.outcomes = [AsrStreamError("upstream")]
    chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM), final_empty=True)(pcm_to_wav(BUFFERED_PCM))
    assert got == TimedText("from chat", ())
