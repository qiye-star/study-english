"""流水线里的真实时间与 low_confidence(plan 2026-10-13-library-alignment):没有任何静音的素材(持续背景音乐)。"""
import shutil
import subprocess

import pytest

from app.library import limits, paths
from app.library.asr_chunks import Silence, load_state, plan_chunks
from app.library.media import Ffmpeg
from app.speech.timed import TimedText, Utterance
from tests.library_helpers import FakeAsr, FakeTimedAsr, FakeTools, enable, fake_media, library_settings, process, upload, use_fakes
from tests.test_library_worker import UID, get, seed, sentences  # noqa: F401

LINES = ["Welcome back to the show everyone.", "Today we are talking about learning English.",
         "Let us begin with a simple question."]
TEXT = " ".join(LINES)
UTTS = (Utterance(LINES[0], 18_000, 21_200), Utterance(LINES[1], 22_000, 26_400), Utterance(LINES[2], 27_300, 30_100))
HELLO = "Hello and welcome to this lesson today."
THREE = "Now we practice speaking together today. Then we listen and repeat out loud now. After that we sing a short song."


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_asr_enabled=True)


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def test_real_times_beat_the_character_estimate_under_continuous_music(app):
    use_fakes(app, FakeTools(silences=[]), timed_asr=FakeTimedAsr([TimedText(TEXT, UTTS)]))
    item_id = await seed(app, fake_media(40_000, video=False))
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.sub_source, item.asr_seconds, item.low_confidence) == ("ready", "asr", 40, False)
    assert await sentences(app, item_id) == [(18_000, 21_200, LINES[0]), (22_000, 26_400, LINES[1]), (27_300, 30_100, LINES[2])]


async def test_a_tail_without_utterances_does_not_move_the_real_times(app, monkeypatch):
    """Real finding (Task 0, clip B): the recognizer returned nothing for the last part of the audio."""
    monkeypatch.setattr(limits, "ASR_CONCURRENCY", 1)  # chunk order = call order
    use_fakes(app, FakeTools(silences=[]), timed_asr=FakeTimedAsr([TimedText(TEXT, UTTS)]))
    item_id = await seed(app, fake_media(60_000, video=False))
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.low_confidence) == ("ready", False)
    out = await sentences(app, item_id)
    assert out[0] == (18_000, 21_200, LINES[0]) and out[-1][1] == 30_100


async def test_without_times_the_same_audio_is_spread_flat_and_flagged(app):
    """The old behaviour, kept as the fallback: no silences, no times -> text spread over the whole hard-cut chunk."""
    use_fakes(app, FakeTools(silences=[]), asr=FakeAsr([TEXT]))
    item_id = await seed(app, fake_media(40_000, video=False))
    await process(app)
    out = await sentences(app, item_id)
    item = await get(app, item_id)
    assert out[0][0] == 0 and out[0][1] > 10_000  # the first sentence "starts" at 0 s although the voice starts at 18 s
    assert item.low_confidence is True  # ... which is exactly what the check exists to tell the learner


async def test_utterances_that_do_not_match_the_text_are_not_believed(app):
    wrong = TimedText(TEXT, (Utterance("Something else entirely different.", 18_000, 21_200),))
    use_fakes(app, FakeTools(silences=[]), timed_asr=FakeTimedAsr([wrong]))
    item_id = await seed(app, fake_media(40_000, video=False))
    await process(app)
    out = await sentences(app, item_id)
    assert out[0][0] == 0 and (await get(app, item_id)).low_confidence is True


async def test_trusted_and_estimated_chunks_mix_in_one_item(app, monkeypatch):
    monkeypatch.setattr(limits, "ASR_CONCURRENCY", 1)  # chunk order = call order
    first = TimedText(HELLO, (Utterance(HELLO, 5_000, 8_000),))
    use_fakes(app, FakeTools(silences=[Silence(29_800, 30_400)]), timed_asr=FakeTimedAsr([first, THREE]))
    item_id = await seed(app, fake_media(60_000, video=False))
    await process(app)
    assert plan_chunks(60_000, [Silence(29_800, 30_400)])[0].end_ms == 30_100  # two chunks
    out = await sentences(app, item_id)
    assert out[0] == (5_000, 8_000, HELLO)  # real times
    assert len(out) == 4 and out[1][0] == 30_400 and out[-1][1] == 60_000  # the second chunk: speech span of the estimate


async def test_a_failed_chunk_keeps_the_finished_chunks_times_in_the_checkpoint(app, monkeypatch):
    monkeypatch.setattr(limits, "ASR_CONCURRENCY", 1)
    first = TimedText(HELLO, (Utterance(HELLO, 5_000, 8_000),))
    boom = RuntimeError("x")
    use_fakes(app, FakeTools(silences=[Silence(29_800, 30_400)]), timed_asr=FakeTimedAsr([first, boom, boom, boom]))
    item_id = await seed(app, fake_media(60_000, video=False))
    await process(app)
    state = load_state(paths.tmp_dir(app.state.library.deps.data_dir, item_id) / "chunks.json")
    assert state[0].utterances == list(first.utterances) and state[1].text is None


async def test_low_confidence_is_exposed_by_the_api_and_false_for_subtitles(app, client, auth_headers):
    use_fakes(app, FakeTools(silences=[]), asr=FakeAsr([TEXT]))
    flat = await upload(client, auth_headers, fake_media(40_000, video=False), filename="a.m4a")
    await process(app)
    body = (await client.get(f"/api/library/items/{flat}", headers=auth_headers)).json()
    assert body["item"]["low_confidence"] is True and body["item"]["sub_source"] == "asr"
    listed = (await client.get("/api/library/items", headers=auth_headers)).json()["items"]
    assert [i["low_confidence"] for i in listed] == [True]
    from tests.library_helpers import SRT
    use_fakes(app)
    subs = await upload(client, auth_headers, fake_media(), subs=SRT)
    await process(app)
    assert (await client.get(f"/api/library/items/{subs}", headers=auth_headers)).json()["item"]["low_confidence"] is False


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
async def test_the_fixture_audio_really_has_no_silence_for_the_pipelines_detector(tmp_path):
    """A continuous tone stands in for background music: `silencedetect=noise=-35dB:d=0.35` finds nothing, so the old
    chunker hard-cuts at 40 s (the reported cause)."""
    src = tmp_path / "music.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "sine=f=220:d=40", str(src)], check=True, timeout=120)
    silences = await Ffmpeg().speech_wav(src, tmp_path / "speech.wav", 40_000, home=tmp_path)
    assert silences == []
    assert plan_chunks(100_000, silences)[0].end_ms == 40_000
