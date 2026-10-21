"""The pipeline's file seam: media and posters are put into the store, staging stays local (plan L1 Task 9, R6, R7).

Runs on the local and the moto S3 backend. The worker runs one round through `process(app)`; no polling loop."""
import pytest
from sqlalchemy import select

from app.library import paths, pipeline
from app.models import LibraryItem, LibrarySegment, User
from app.storage import StorageError
from tests.background import drain_background
from tests.library_helpers import SRT, FakeTools, enable, fake_media, library_settings, process, use_fakes
from tests.storage_helpers import keys_under_store

UID = 12345678


@pytest.fixture
def settings_overrides(request, tmp_path):
    return library_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def seed(app, data: bytes | None = None, *, subs: bytes | None = None, status="queued") -> str:
    async with app.state.sessionmaker() as s:
        if await s.get(User, UID) is None:
            s.add(User(id=UID, username="owner", password_hash="x"))
        row = LibraryItem(user_id=UID, kind="video", source="upload", title="clip", status=status,
                          upload_total=len(data or b""))
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


async def stored_keys(app) -> list[str]:
    return await keys_under_store(app.state.storage, f"library/{UID}/")


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_an_upload_with_subtitles_is_ready_and_its_files_are_in_the_store(app, storage_backend):
    use_fakes(app)
    item_id = await seed(app, fake_media(6000), subs=SRT)
    assert await process(app) == 1
    item = await get(app, item_id)
    assert (item.status, item.seg_count, item.sub_source) == ("ready", 2, "uploaded")
    assert item.media_path == f"library/{UID}/{item_id}/media.mp4" and item.poster_path.endswith("poster.jpg")
    assert await stored_keys(app) == [item.media_path, item.poster_path]
    assert item.library_bytes == sum(info.size for info in [
        await app.state.storage.stat(item.media_path), await app.state.storage.stat(item.poster_path)])
    assert not paths.tmp_dir(app.state.library.deps.data_dir, item_id).exists()


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_nothing_is_left_behind_when_the_item_is_canceled_before_commit(app, storage_backend, monkeypatch):
    class CancelDuringNormalize(FakeTools):
        async def normalize(self, src, info, out_dir, **kwargs):
            result = await super().normalize(src, info, out_dir, **kwargs)
            async with app.state.sessionmaker() as s:  # the user cancels while the file is being prepared
                await s.execute(LibraryItem.__table__.update().values(status="canceled"))
                await s.commit()
            return result

    use_fakes(app, CancelDuringNormalize())
    item_id = await seed(app, fake_media(6000), subs=SRT)
    await process(app)
    await drain_background(app)
    assert await stored_keys(app) == []
    assert (await get(app, item_id)).media_path is None


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_a_store_outage_while_putting_the_media_is_a_transient_network_error(app, storage_backend,
                                                                                    monkeypatch):
    use_fakes(app)

    async def down(key, path, **kwargs):
        raise StorageError("unavailable")

    monkeypatch.setattr(app.state.storage, "put_file", down)
    item_id = await seed(app, fake_media(6000), subs=SRT)
    await process(app)
    item = await get(app, item_id)
    assert item.error_kind == "network"
    assert item.media_path is None
    assert await stored_keys(app) == []


async def test_a_resumed_subtitle_item_does_not_download_the_media(app, monkeypatch):
    """Subtitle-only items never need the media locally: the resume path reads the store with stat only."""
    use_fakes(app)
    item_id = await seed(app, fake_media(6000), subs=SRT)
    await process(app)
    item = await get(app, item_id)
    async with app.state.sessionmaker() as s:
        await s.execute(LibraryItem.__table__.update().where(LibraryItem.id == item_id).values(
            status="processing", seg_count=0))
        await s.commit()
    calls = []

    async def record(key, dst):
        calls.append(key)
        raise AssertionError("no download expected")

    monkeypatch.setattr(app.state.storage, "download_to", record)
    tmp = paths.tmp_dir(app.state.library.deps.data_dir, item_id)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / pipeline.UPLOADED_SUBS).write_bytes(SRT)
    async with app.state.sessionmaker() as s:
        row = await s.get(LibraryItem, item_id)
        await pipeline.process(app.state.library.deps, row.id)
    assert calls == []
    assert (await get(app, item_id)).status == "ready"
    assert item.media_path == (await get(app, item_id)).media_path


async def test_segments_are_written_for_the_ready_item(app):
    use_fakes(app)
    item_id = await seed(app, fake_media(6000), subs=SRT)
    await process(app)
    async with app.state.sessionmaker() as s:
        count = len((await s.scalars(select(LibrarySegment).where(LibrarySegment.item_id == item_id))).all())
    assert count == 2
