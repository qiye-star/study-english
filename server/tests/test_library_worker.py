"""流水线与后台队列(spec §6):假媒体工具、假识别;不起轮询循环,用 run_once() 手动驱动(tests/background.py)。"""
import asyncio
import json
import shutil
import subprocess
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core import metering
from app.library import limits, paths, pipeline
from app.library.asr_chunks import Silence, load_state
from app.library.errors import LibraryError
from app.library.media import Ffmpeg
from app.models import DailyUsage, LibraryItem, LibrarySegment, User, utcnow
from tests.background import drain_background
from tests.library_helpers import SRT, FakeAsr, FakeTools, enable, fake_media, library_settings, process, use_fakes

UID = 12345678


@pytest.fixture
def settings_overrides(request, tmp_path):
    return library_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def seed(app, data: bytes | None = None, *, subs: bytes | None = None, source="upload", url=None,
               title="clip", status="queued", **kw) -> str:
    async with app.state.sessionmaker() as s:
        if await s.get(User, UID) is None:
            s.add(User(id=UID, username="owner", password_hash="x"))
        row = LibraryItem(user_id=UID, kind="video", source=source, title=title, status=status, source_url=url,
                          source_host="www.example.com" if url else None, upload_total=len(data or b""), **kw)
        s.add(row)
        await s.commit()
        item_id = row.id
    tmp = paths.tmp_dir(app.state.library.deps.data_dir, item_id)
    tmp.mkdir(parents=True, exist_ok=True)
    if data is not None:
        (tmp / "in.mp4").write_bytes(data)
    if subs is not None:
        (tmp / pipeline.UPLOADED_SUBS).write_bytes(subs)
    return item_id


async def get(app, item_id) -> LibraryItem:
    async with app.state.sessionmaker() as s:
        return await s.get(LibraryItem, item_id)


async def sentences(app, item_id) -> list[tuple[int, int, str]]:
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(LibrarySegment).where(LibrarySegment.item_id == item_id)
                                .order_by(LibrarySegment.idx))).all()
    return [(r.start_ms, r.end_ms, r.text) for r in rows]


async def test_upload_with_subtitles_becomes_ready(app):
    tools = use_fakes(app)
    item_id = await seed(app, fake_media(6000), subs=SRT)
    assert await process(app) == 1
    item = await get(app, item_id)
    assert (item.status, item.progress, item.stage, item.sub_source, item.seg_count) == ("ready", 100, None, "uploaded", 2)
    assert (item.kind, item.duration_ms, item.media_mime) == ("video", 6000, "video/mp4")
    assert item.media_path == f"library/{UID}/{item_id}/media.mp4" and item.poster_path.endswith("poster.jpg")
    data_dir = app.state.library.deps.data_dir
    assert item.library_bytes == (data_dir / item.media_path).stat().st_size + (data_dir / item.poster_path).stat().st_size
    assert not paths.tmp_dir(data_dir, item_id).exists()
    assert await sentences(app, item_id) == [(500, 3000, "Hello there, my friend."), (3200, 6000, "How are you doing today?")]
    assert tools.calls == ["probe", "normalize", "poster"]


async def test_no_subtitles_and_no_recognizer_fails_but_keeps_the_media(app):
    use_fakes(app)
    item_id = await seed(app, fake_media(4000, video=False))
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.error_kind, item.kind, item.poster_path) == ("failed", "no_subtitles", "audio", None)
    assert (app.state.library.deps.data_dir / item.media_path).is_file()
    assert await app.state.library.run_once() == 0  # permanent: no automatic retry


@pytest.mark.parametrize("settings_overrides", [{"library_asr_enabled": True}], indirect=True)
async def test_transcription_path_counts_seconds_and_snaps_to_silences(app, monkeypatch):
    monkeypatch.setattr(limits, "ASR_CONCURRENCY", 1)  # chunk order = call order, so the fake texts line up
    seen = {}

    class Spy(FakeAsr):
        def __call__(self, user_id):
            inner = super().__call__(user_id)

            async def transcribe(wav):
                seen["feature"], seen["user"] = metering.current_feature(), metering.current_user_id()
                return await inner(wav)
            return transcribe

    first = "One two three four. Five six seven eight. Nine ten eleven twelve. Thirteen fourteen fifteen sixteen."
    second = "We are done for today. Thank you all very much. See you again next time. Goodbye to everyone here."
    asr = Spy([first, second])
    use_fakes(app, FakeTools(silences=[Silence(5_500, 6_100), Silence(29_800, 30_400)]), asr)
    item_id = await seed(app, fake_media(60_000, video=False))
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.sub_source, item.asr_seconds) == ("ready", "asr", 61)
    assert asr.calls == [30_100, 29_900] and seen == {"feature": "library", "user": UID}
    out = await sentences(app, item_id)
    assert [t for _, _, t in out] == ["One two three four.", "Five six seven eight.", "Nine ten eleven twelve.",
                                      "Thirteen fourteen fifteen sixteen.", "We are done for today.",
                                      "Thank you all very much.", "See you again next time.", "Goodbye to everyone here."]
    assert out[0][1] == out[1][0] == 5_800  # snapped to the silence middle (the estimate was 5.66 / 5.96 s)
    assert out[3][1] <= 30_100 <= out[4][0]  # the chunk edge sits in the long silence
    async with app.state.sessionmaker() as s:
        counts = {r.subject: r.count for r in (await s.scalars(select(DailyUsage).where(
            DailyUsage.scope == "library_asr"))).all()}
    assert counts == {str(UID): 61, "*": 61}


@pytest.mark.parametrize("settings_overrides", [{"library_asr_enabled": True}], indirect=True)
async def test_transcription_failure_retries_from_the_checkpoint_and_refunds(app, monkeypatch):
    monkeypatch.setattr(limits, "ASR_CONCURRENCY", 1)
    asr = FakeAsr(["First chunk words here.", RuntimeError("x"), RuntimeError("x"), RuntimeError("x")])
    use_fakes(app, FakeTools(silences=[Silence(29_800, 30_400)]), asr)
    item_id = await seed(app, fake_media(60_000, video=False))
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.error_kind, item.attempts, item.asr_seconds) == ("queued", "upstream", 1, 31)
    assert item.next_run_at is not None
    state = load_state(paths.tmp_dir(app.state.library.deps.data_dir, item_id) / "chunks.json")
    assert [c.text for c in state] == ["First chunk words here.", None]
    async with app.state.sessionmaker() as s:
        assert {r.subject: r.count for r in (await s.scalars(select(DailyUsage))).all()
                if r.scope == "library_asr"} == {str(UID): 31, "*": 31}
        row = await s.get(LibraryItem, item_id)
        row.next_run_at = utcnow() - timedelta(seconds=1)
        await s.commit()
    asr.texts = ["Second chunk words here."]
    asr.calls.clear()
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.asr_seconds, len(asr.calls)) == ("ready", 61, 1)


@pytest.mark.parametrize("settings_overrides", [{"library_asr_enabled": True,
                                                 "library_asr_minutes_daily_per_user": 0}], indirect=True)
async def test_transcription_over_the_daily_minutes_is_a_quota_failure(app):
    use_fakes(app, asr=FakeAsr(["never"]))
    item_id = await seed(app, fake_media(20_000, video=False))
    await process(app)
    assert ((await get(app, item_id)).status, (await get(app, item_id)).error_kind) == ("failed", "quota")


@pytest.mark.parametrize("data, kind", [
    (fake_media(5000, audio=False), "no_audio"), (fake_media(91 * 60_000), "too_long"), (b"not media", "corrupt"),
], ids=["no-audio", "too-long", "corrupt"])
async def test_permanent_media_failures_drop_the_staging_files(app, data, kind):
    use_fakes(app)
    item_id = await seed(app, data, subs=SRT)
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.error_kind, item.attempts) == ("failed", kind, 0)
    assert not paths.tmp_dir(app.state.library.deps.data_dir, item_id).exists()


async def test_transient_tool_failures_back_off_30_then_120_seconds_then_fail(app):
    use_fakes(app, FakeTools(fail={"normalize": "upstream"}))
    item_id = await seed(app, fake_media(), subs=SRT)
    for expected in (30, 120):
        before = utcnow()
        await process(app)
        item = await get(app, item_id)
        delay = (item.next_run_at.replace(tzinfo=None) - before.replace(tzinfo=None)).total_seconds()
        assert item.status == "queued" and expected - 2 <= delay <= expected + 2
        async with app.state.sessionmaker() as s:
            row = await s.get(LibraryItem, item_id)
            row.next_run_at = None
            await s.commit()
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.error_kind, item.attempts) == ("failed", "upstream", 2)
    assert paths.tmp_dir(app.state.library.deps.data_dir, item_id).exists()  # kept for a manual retry


async def test_links_fail_until_plan_s2_registers_a_fetch_stage(app):
    use_fakes(app)
    app.state.library.set_fetch_stage(pipeline.NoFetch())  # create_app now registers yt-dlp (plan S2); pin the default
    item_id = await seed(app, source="link", url="https://www.example.com/v/1", title="")
    await process(app)
    assert ((await get(app, item_id)).error_kind) == "unsupported_site"


async def test_a_registered_fetch_stage_supplies_media_title_and_platform_subtitles(app):
    use_fakes(app)
    requests = []

    class Fetch:
        async def fetch(self, req: pipeline.FetchRequest) -> pipeline.FetchResult:
            requests.append(req)
            await req.report(50)
            (req.tmp_dir / "dl.mp4").write_bytes(fake_media(6000))
            (req.tmp_dir / "subs.en.srt").write_bytes(SRT)
            return pipeline.FetchResult(media_path=req.tmp_dir / "dl.mp4", title="A page title", duration_ms=6000,
                                        subtitle_path=req.tmp_dir / "subs.en.srt", subtitle_auto=False,
                                        source_host="www.example.com")

    app.state.library.set_fetch_stage(Fetch())
    assert isinstance(app.state.library.fetch_stage, Fetch)
    item_id = await seed(app, source="link", url="https://www.example.com/v/1", title="")
    named = await seed(app, source="link", url="https://www.example.com/v/2", title="My own name")
    # one job per round: two tasks would share the test's single SQLite connection (StaticPool), where one task's
    # session close rolls back the other's executed-but-uncommitted title update
    await process(app)
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.sub_source, item.title, item.source_url) == ("ready", "platform", "A page title", None)
    assert (await get(app, named)).title == "My own name"  # a user title is never replaced
    req = next(r for r in requests if r.url.endswith("/1"))
    assert (req.url, req.user_id, req.asr_available, req.settings.library_transcode_max_height) == (
        "https://www.example.com/v/1", UID, False, 720)
    assert req.tmp_dir == paths.tmp_dir(app.state.library.deps.data_dir, item_id)


async def test_concurrency_and_the_switch(app):
    use_fakes(app)
    for _ in range(3):
        await seed(app, fake_media(), subs=SRT)
    assert await process(app) == 1  # library_job_concurrency = 1
    app.state.settings = app.state.settings.model_copy(update={"library_job_concurrency": 4})
    assert await process(app) == 2
    await seed(app, fake_media(), subs=SRT)
    app.state.settings = app.state.settings.model_copy(update={"library_enabled": False})
    assert await app.state.library.run_once() == 0


async def test_cancel_stops_a_running_job_and_cleans_up(app):
    gate = asyncio.Event()

    class Slow(FakeTools):
        async def normalize(self, *a, **kw):
            gate.set()
            await asyncio.sleep(30)

    use_fakes(app, Slow())
    item_id = await seed(app, fake_media(), subs=SRT)
    await app.state.library.run_once()
    await asyncio.wait_for(gate.wait(), 5)
    async with app.state.sessionmaker() as s:
        row = await s.get(LibraryItem, item_id)
        row.status = "canceled"
        await s.commit()
    await app.state.library.cancel(item_id)
    await drain_background(app)
    assert (await get(app, item_id)).status == "canceled"
    assert not paths.tmp_dir(app.state.library.deps.data_dir, item_id).exists()
    assert app.state.library.running == {}


async def test_a_deleted_item_aborts_quietly(app):
    class Deleting(FakeTools):
        async def normalize(self, src, info, out_dir, **kw):
            async with app.state.sessionmaker() as s:
                await s.delete(await s.get(LibraryItem, item_id))
                await s.commit()
            return await super().normalize(src, info, out_dir, **kw)

    use_fakes(app, Deleting())
    item_id = await seed(app, fake_media(), subs=SRT)
    await process(app)
    data_dir = app.state.library.deps.data_dir
    assert not paths.item_dir(data_dir, UID, item_id).exists() and not paths.tmp_dir(data_dir, item_id).exists()


async def test_shutdown_leaves_processing_rows_for_recovery_and_the_loop_recovers_them(app):
    class Slow(FakeTools):
        async def normalize(self, *a, **kw):
            await asyncio.sleep(30)

    use_fakes(app, Slow())
    item_id = await seed(app, fake_media(), subs=SRT)
    await app.state.library.run_once()
    await asyncio.sleep(0.05)
    await app.state.library.shutdown(wait=2)
    assert (await get(app, item_id)).status == "processing"
    use_fakes(app)
    loop = asyncio.create_task(app.state.library.loop())
    try:
        for _ in range(100):
            await asyncio.sleep(0.05)
            await drain_background(app)
            if (await get(app, item_id)).status == "ready":
                break
        assert (await get(app, item_id)).status == "ready"
    finally:
        loop.cancel()
        await asyncio.gather(loop, return_exceptions=True)


async def test_sweep_expires_uploads_purges_old_failures_and_orphan_staging(app):
    worker = app.state.library
    data_dir = worker.deps.data_dir
    now = utcnow()
    expired = await seed(app, status="uploading", updated_at=now - timedelta(hours=25))
    stale = await seed(app, status="failed", updated_at=now - timedelta(days=8), media_path=None)
    paths.item_dir(data_dir, UID, stale).mkdir(parents=True)
    ready = await seed(app, status="ready")
    kept = await seed(app, status="failed")
    orphan = paths.tmp_dir(data_dir, "0f0e0d0c-0b0a-4908-8706-050403020100")
    orphan.mkdir(parents=True)
    counts = await worker.sweep(now)
    assert counts == {"expired": 1, "purged": 1, "orphans": 2}
    assert (await get(app, expired)).error_kind == "upload_expired" and await get(app, stale) is None
    assert not paths.item_dir(data_dir, UID, stale).exists() and not orphan.exists()
    assert not paths.tmp_dir(data_dir, ready).exists() and paths.tmp_dir(data_dir, kept).exists()


def test_fetch_interface_is_the_s2_contract():
    assert list(pipeline.FetchRequest.__dataclass_fields__) == ["item_id", "user_id", "url", "tmp_dir", "settings",
                                                                "asr_available", "report", "system"]
    assert list(pipeline.FetchResult.__dataclass_fields__) == ["media_path", "title", "duration_ms", "subtitle_path",
                                                               "subtitle_auto", "source_host"]


async def test_no_fetch_raises_unsupported_site():
    with pytest.raises(LibraryError) as e:
        await pipeline.NoFetch().fetch(None)
    assert e.value.kind == "unsupported_site"


def test_staging_rule_lists_are_json_safe():
    from app.library.worker import DROP_STAGING
    assert "no_subtitles" not in DROP_STAGING and "quota" not in DROP_STAGING and "upstream" not in DROP_STAGING
    json.dumps(sorted(DROP_STAGING))


@pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg not installed")
async def test_real_ffmpeg_end_to_end(app):
    """The default tools (real ffmpeg / ffprobe): a VP9/Opus webm upload with subtitles becomes an H.264/AAC mp4."""
    item_id = await seed(app, None, subs=SRT)
    src = paths.tmp_dir(app.state.library.deps.data_dir, item_id) / "in.webm"
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=320x240:rate=10:duration=6", "-f", "lavfi", "-i", "sine=f=440:d=6", "-shortest",
                    "-c:v", "libvpx-vp9", "-c:a", "libopus", str(src)], check=True, timeout=120)
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.kind, item.media_mime, item.seg_count) == ("ready", "video", "video/mp4", 2)
    info = await Ffmpeg().probe(app.state.library.deps.data_dir / item.media_path, home=src.parent.parent)
    assert (info.vcodec, info.acodec) == ("h264", "aac") and item.poster_path is not None
