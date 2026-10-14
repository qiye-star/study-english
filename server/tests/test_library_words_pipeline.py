"""词路径接进流水线(plan 2026-10-14-library-alignment-v2 R-V5、R-V8、R-V14):词级时间到达接口、硬切处重叠、
识别结果保留在条目目录、重新识别失败时旧的识别结果不动。助手也给 `test_library_rebuild.py` 用。"""
import pytest

from app.library import paths
from app.library.asr_chunks import load_transcript
from app.library.pipeline import TRANSCRIPT
from app.speech.timed import TimedText, Utterance, Word
from tests.library_helpers import FakeAsr, FakeTimedAsr, FakeTools, enable, fake_media, library_settings, process, upload, use_fakes
from tests.library_words import utt

A = "SECRET-TRANSCRIPT welcome back to my channel."
B = "Today we talk about the city."
C = "It costs twenty five dollars, honestly."


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_asr_enabled=True)


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


def timed(*utts: Utterance) -> TimedText:
    return TimedText(" ".join(u.text for u in utts), utts)


def transcript_path(app, uid: int, item_id: str):
    return paths.item_dir(app.state.library.deps.data_dir, uid, item_id) / TRANSCRIPT


async def uid_of(client, h) -> int:
    return int((await client.get("/api/me", headers=h)).json()["id"])


async def word_item(app, client, h, *results) -> str:
    """A 40 s audio item (one chunk, no silences) recognized with the given timed results."""
    use_fakes(app, FakeTools(silences=[]), timed_asr=FakeTimedAsr(list(results)))
    item_id = await upload(client, h, fake_media(40_000, video=False), filename="Pod.m4a", title="Pod")
    await process(app)
    return item_id


async def detail(client, h, item_id) -> dict:
    return (await client.get(f"/api/library/items/{item_id}", headers=h)).json()


def mismatched() -> Utterance:
    """A recognizer sentence whose words do not match its text: every token is spread (`interp`) -> flagged `timing`."""
    return Utterance(C, 34_000, 36_000, (Word("zzz", 34_000, 34_500), Word("qqq", 35_000, 36_000)))


async def test_word_times_reach_the_api_and_the_transcript_is_kept(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360), utt(B, 31_000)))
    body = await detail(client, auth_headers, item_id)
    assert (body["item"]["status"], body["item"]["rebuildable"], body["item"]["low_confidence"]) == ("ready", True, False)
    assert [s["text"] for s in body["segments"]] == [A, B]
    assert body["segments"][0]["start_ms"] == 27_360 - 40 and body["segments"][0]["flags"] == []
    kept = load_transcript(transcript_path(app, await uid_of(client, auth_headers), item_id))
    assert kept is not None and kept[0][0].utterances[0].words[0] == Word("SECRET-TRANSCRIPT", 27_360, 27_660)
    assert not paths.tmp_dir(app.state.library.deps.data_dir, item_id).exists()


async def test_a_sentence_whose_words_do_not_match_is_flagged(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360), utt(B, 31_000), mismatched()))
    segs = (await detail(client, auth_headers, item_id))["segments"]
    assert segs[-1]["text"] == C and "timing" in segs[-1]["flags"]


async def test_hard_cuts_overlap_only_on_the_word_path(app, client, auth_headers):
    fake = FakeTimedAsr([timed(utt(A, 27_360)), ""])
    use_fakes(app, FakeTools(silences=[]), timed_asr=fake)
    item_id = await upload(client, auth_headers, fake_media(60_000, video=False), filename="Pod.m4a")
    await process(app)
    assert sorted(fake.calls) == [21_000, 41_000]  # [0, 41 s) and [39 s, 60 s)
    assert (await detail(client, auth_headers, item_id))["item"]["status"] == "ready"
    text_only = FakeAsr([A, ""])
    use_fakes(app, FakeTools(silences=[]), asr=text_only)
    await upload(client, auth_headers, fake_media(60_000, video=False), filename="Pod.m4a")
    await process(app)
    assert sorted(text_only.calls) == [20_000, 40_000]  # no times, no overlap: v1 chunks


async def test_a_failed_re_recognition_keeps_the_old_transcript(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360)))
    path = transcript_path(app, await uid_of(client, auth_headers), item_id)
    old = path.read_bytes()
    use_fakes(app, FakeTools(fail={"speech_wav": "corrupt"}), timed_asr=FakeTimedAsr([]))
    assert (await client.post(f"/api/library/items/{item_id}/reprocess", headers=auth_headers)).status_code == 200
    await process(app)
    item = (await detail(client, auth_headers, item_id))["item"]
    assert (item["status"], item["error_kind"], item["rebuildable"]) == ("ready", "corrupt", True)
    assert path.read_bytes() == old
