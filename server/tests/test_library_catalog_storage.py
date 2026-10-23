"""Curated catalog files on the object store (plan L1 Task 11): the admin list makes ONE listing, the admin preview
streams with Range, and a missing object shows as `media_missing`. Runs on the local and the moto S3 backend."""
import pytest

from app.library import catalog_store
from app.models import CatalogItem
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.catalog_helpers import MEDIA, make_catalog
from tests.library_helpers import library_settings

BASE = "/api/admin/library/catalog"


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True)}


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_admin_list_checks_media_with_one_listing(app, client, storage_backend, monkeypatch):
    h = await login_as(app, client, "viewer")
    gone = await make_catalog(app, title="Gone soon")
    await make_catalog(app, title="Still here")
    await app.state.storage.delete(f"library/_catalog/{gone}/media.m4a")

    heads = []
    original_stat = app.state.storage.stat

    async def counting_stat(key):
        heads.append(key)
        return await original_stat(key)

    monkeypatch.setattr(app.state.storage, "stat", counting_stat)
    items = (await client.get(BASE, headers=h)).json()["items"]
    flags = {item["id"]: item["media_missing"] for item in items}
    assert flags[gone] is True
    assert sorted(flags.values()) == [False, True]
    assert heads == []  # the list used one listing, never a HEAD per item


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_admin_preview_streams_with_range_from_the_store(app, client, storage_backend):
    h = await login_as(app, client, "viewer")
    cid = await make_catalog(app)
    r = await client.get(f"{BASE}/{cid}/media", headers={**h, "Range": "bytes=0-9"})
    assert (r.status_code, r.content) == (206, MEDIA[:10])
    r = await client.get(f"{BASE}/{cid}/media", headers=h)
    assert (r.status_code, r.content) == (200, MEDIA)


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_publish_refuses_a_missing_media_object(app, client, storage_backend):
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app, published=False)
    await app.state.storage.delete(f"library/_catalog/{cid}/media.m4a")
    r = await client.post(f"{BASE}/{cid}/publish", headers=h, json={})
    assert r.status_code == 409


async def test_the_catalog_row_still_points_at_the_store_keys(app):
    cid = await make_catalog(app)
    async with app.state.sessionmaker() as s:
        row = await s.get(CatalogItem, cid)
        assert await catalog_store.media_missing_stored(app.state.storage, row) is False
