"""Library media and posters served through the store (plan L1 Task 10, R8): the same answers on both backends."""
import logging

import pytest

from app.storage import StorageError
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, upload, use_fakes


@pytest.fixture
def settings_overrides(request, tmp_path):
    return library_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def _ready_item(app, client, headers) -> tuple[str, str, bytes]:
    use_fakes(app)
    data = fake_media(6000)
    item_id = await upload(client, headers, data, subs=SRT)
    await process(app)
    url = (await client.post(f"/api/library/items/{item_id}/media-ticket", headers=headers)).json()["url"]
    return item_id, url, data


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_media_plays_with_ranges_from_the_store(app, client, auth_headers, storage_backend):
    _item_id, url, data = await _ready_item(app, client, auth_headers)
    full = await client.get(url)
    assert (full.status_code, full.content) == (200, data)
    part = await client.get(url, headers={"Range": "bytes=0-9"})
    assert (part.status_code, part.content) == (206, data[:10])
    assert part.headers["content-range"] == f"bytes 0-9/{len(data)}"
    assert (await client.get(url, headers={"Range": f"bytes={len(data)}-"})).status_code == 416


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_poster_is_served_from_the_store(app, client, auth_headers, storage_backend):
    item_id, _url, _data = await _ready_item(app, client, auth_headers)
    r = await client.get(f"/api/library/items/{item_id}/poster", headers=auth_headers)
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_a_missing_object_is_a_404_not_a_500(app, client, auth_headers, storage_backend):
    item_id, url, _data = await _ready_item(app, client, auth_headers)
    async with app.state.sessionmaker() as s:
        from app.models import LibraryItem
        item = await s.get(LibraryItem, item_id)
    await app.state.storage.delete(item.media_path)
    assert (await client.get(url)).status_code == 404


@pytest.mark.parametrize("storage_backend", ["s3"], indirect=True)
async def test_a_store_outage_is_a_503_and_logs_no_key(app, client, auth_headers, storage_backend, monkeypatch,
                                                       caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    _item_id, url, _data = await _ready_item(app, client, auth_headers)

    async def down(key, start=0, end=None):
        raise StorageError("unavailable")

    monkeypatch.setattr(app.state.storage, "open_range", down)
    r = await client.get(url, headers={"Range": "bytes=0-9"})
    assert (r.status_code, r.json()) == (503, {"error": "Storage unavailable"})
    text = " ".join(rec.getMessage() for rec in caplog.records)
    assert "library/" not in text and "media.mp4" not in text
