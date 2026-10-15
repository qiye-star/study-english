"""一条目录条目的导入(spec 2026-10-14-curated-library §7;plan SI Task 3)。"""
import json
import logging

import httpx
import pytest
import respx

from app.library import catalog_import, catalog_store, paths, pipeline
from app.library.errors import Aborted, LibraryError
from app.library.pipeline import FetchResult
from app.models import CatalogItem
from tests.library_helpers import SRT, FakeAsr, fake_media, library_settings, use_fakes

LLM = "https://llm.test/v1/chat/completions"


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_ai_enabled=True)


class FakeFetch:
    """A link fetch: writes the media (and optional subtitles) into the request's `_tmp`, records the request."""

    def __init__(self, media: bytes, subs: bytes | None = None, title: str | None = "Page title"):
        self.media, self.subs, self.title = media, subs, title
        self.requests = []

    async def fetch(self, req):
        self.requests.append(req)
        req.tmp_dir.mkdir(parents=True, exist_ok=True)
        (req.tmp_dir / "dl.mp4").write_bytes(self.media)
        subs = None
        if self.subs is not None:
            subs = req.tmp_dir / "subs.en.srt"
            subs.write_bytes(self.subs)
        await req.report(100)
        return FetchResult(media_path=req.tmp_dir / "dl.mp4", title=self.title, duration_ms=6000,
                           subtitle_path=subs, subtitle_auto=False, source_host="learningenglish.voanews.com")


async def queued(app, *, source="upload", title="Talk", url=None, status="processing") -> str:
    async with app.state.sessionmaker() as s:
        row = await catalog_store.create(s, source=source, status=status, title=title, level="B1", tags=[],
                                         license_note=None, ai_lang="zh-CN", source_url=url)
        return row.id


def staged_upload(app, cid: str, data: bytes, subs: bytes | None = None) -> None:
    tmp = paths.catalog_tmp_dir(app.state.library.deps.data_dir, cid)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / f"{pipeline.INPUT_PREFIX}mp4").write_bytes(data)
    if subs is not None:
        (tmp / pipeline.UPLOADED_SUBS).write_bytes(subs)


async def row_of(app, cid) -> CatalogItem:
    async with app.state.sessionmaker() as s:
        return await s.get(CatalogItem, cid)


def run(app, cid):
    return catalog_import.process(app.state.library.deps, cid, http=app.state.http, translate_template=None)


def reply(text):
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


@respx.mock
async def test_a_video_upload_keeps_the_picture_with_translations(app):
    tools = use_fakes(app)
    respx.post(LLM).mock(return_value=reply("1. 你好,我的朋友。\n2. 你今天好吗?"))
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=True), SRT)
    await run(app, cid)
    row = await row_of(app, cid)
    assert (row.status, row.published, row.sub_source, row.seg_count, row.media_mime) == (
        "ready", False, "uploaded", 2, "video/mp4")
    assert row.media_path == f"{paths.catalog_rel(cid)}/media.mp4" and row.poster_path.endswith("poster.jpg")
    data_dir = app.state.library.deps.data_dir
    assert (paths.catalog_dir(data_dir, cid) / "media.mp4").is_file()
    assert not paths.catalog_tmp_dir(data_dir, cid).exists()
    assert "normalize" in tools.calls and "audio_only" not in tools.calls
    assert tools.normalize_kwargs == {"max_height": 720, "max_kbps": catalog_import.VIDEO_MAX_KBPS}
    async with app.state.sessionmaker() as s:
        assert [x.zh for x in await catalog_store.segments_of(s, cid)] == ["你好,我的朋友。", "你今天好吗?"]


async def test_an_audio_source_stays_mono_audio(app):
    tools = use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=False), SRT)
    await run(app, cid)
    row = await row_of(app, cid)
    assert (row.media_mime, row.media_path) == ("audio/mp4", f"{paths.catalog_rel(cid)}/media.m4a")
    assert "audio_only" in tools.calls and "normalize" not in tools.calls
    assert catalog_store.kind_of(row) == "audio"


async def test_the_video_height_follows_a_lower_admin_setting(app):
    tools = use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False,
                                                               "library_transcode_max_height": 480})
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=True), SRT)
    await run(app, cid)
    assert tools.normalize_kwargs["max_height"] == 480


async def test_media_log_lines_carry_only_the_id_kind_and_numbers(app, caplog):
    caplog.set_level(logging.INFO)
    use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    cid = await queued(app, title="Secret talk title")
    staged_upload(app, cid, fake_media(6000, video=True), SRT)
    await run(app, cid)
    assert f"catalog={cid}" in caplog.text and "kind=video" in caplog.text
    assert "Secret talk title" not in caplog.text and "Hello there" not in caplog.text


async def test_audio_source_has_no_poster(app):
    use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=False), SRT)
    await run(app, cid)
    row = await row_of(app, cid)
    assert row.status == "ready" and row.poster_path is None and row.error_kind is None


async def test_link_import_uses_a_system_fetch_and_platform_subtitles(app):
    use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    fetch = FakeFetch(fake_media(6000), subs=SRT)
    app.state.library.set_fetch_stage(fetch)
    cid = await queued(app, source="link", title="", url="https://learningenglish.voanews.com/a/x.html")
    await run(app, cid)
    (req,) = fetch.requests
    assert req.system is True and req.user_id == 0 and req.item_id == cid
    assert req.tmp_dir == paths.catalog_tmp_dir(app.state.library.deps.data_dir, cid)
    row = await row_of(app, cid)
    assert (row.status, row.sub_source, row.title, row.source_url, row.source_host) == (
        "ready", "platform", "Page title", None, "learningenglish.voanews.com")


async def test_without_subtitles_it_transcribes_as_the_system(app):
    asr = FakeAsr(["Hello there, my friend. How are you doing today?"])
    use_fakes(app, asr=asr)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False,
                                                               "library_asr_enabled": True,
                                                               "library_asr_minutes_daily_per_user": 0,
                                                               "library_asr_minutes_global_daily": 0})
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=False))
    await run(app, cid)
    row = await row_of(app, cid)
    assert (row.status, row.sub_source) == ("ready", "asr") and row.seg_count >= 1 and row.asr_seconds > 0
    assert asr.calls  # daily allowances at 0 did not stop it: the catalog reserves none (R-SI4)


async def test_no_subtitles_and_no_asr_fails_permanently(app):
    use_fakes(app)
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, video=False))
    with pytest.raises(LibraryError) as e:
        await run(app, cid)
    assert e.value.kind == "no_subtitles"
    row = await row_of(app, cid)
    assert (paths.catalog_dir(app.state.library.deps.data_dir, cid) / "media.m4a").is_file()  # kept for a retry
    assert row.media_path is not None


async def test_too_long_and_no_audio(app):
    use_fakes(app)
    cid = await queued(app)
    staged_upload(app, cid, fake_media(91 * 60_000), SRT)
    with pytest.raises(LibraryError) as e:
        await run(app, cid)
    assert e.value.kind == "too_long"
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000, audio=False), SRT)
    with pytest.raises(LibraryError) as e:
        await run(app, cid)
    assert e.value.kind == "no_audio"


async def test_a_canceled_item_aborts_without_writing_rows(app):
    use_fakes(app)
    cid = await queued(app, status="canceled")
    with pytest.raises(Aborted):
        await run(app, cid)


@respx.mock
async def test_translation_failures_leave_the_item_ready_with_upstream(app):
    use_fakes(app)
    respx.post(LLM).mock(return_value=httpx.Response(502, json={"error": "boom"}))
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000), SRT)
    await run(app, cid)
    row = await row_of(app, cid)
    assert (row.status, row.error_kind, row.seg_count) == ("ready", "upstream", 2)


@respx.mock
async def test_a_translate_only_rerun_translates_just_the_missing_sentences(app):
    use_fakes(app)
    route = respx.post(LLM).mock(return_value=reply("1. 你今天好吗?"))
    cid = await queued(app)
    staged_upload(app, cid, fake_media(6000), SRT)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    await run(app, cid)
    async with app.state.sessionmaker() as s:
        await catalog_store.set_translations(s, cid, [(0, "Hello there, my friend.", "你好。")], "zh-CN")
        row = await s.get(CatalogItem, cid)
        row.status = "processing"
        await s.commit()
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": True})
    await run(app, cid)
    sent = json.loads(route.calls[0].request.content)["messages"][1]["content"]
    assert "How are you doing today?" in sent and "Hello there" not in sent
    async with app.state.sessionmaker() as s:
        assert [x.zh for x in await catalog_store.segments_of(s, cid)] == ["你好。", "你今天好吗?"]


async def test_logs_carry_no_title_url_or_text(app, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    use_fakes(app)
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": False})
    app.state.library.set_fetch_stage(FakeFetch(fake_media(6000), subs=SRT.replace(b"Hello", b"SECRET-SUB"),
                                                title="SECRET-TITLE"))
    cid = await queued(app, source="link", title="", url="https://example.invalid/SECRET-URL")
    await run(app, cid)
    text = " ".join(f"{r.getMessage()} {r.args!r}" for r in caplog.records)
    assert "SECRET" not in text and any("catalog" in r.getMessage() for r in caplog.records)
