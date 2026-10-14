"""副本与共享文件(spec 2026-10-14-curated-library E7、E9、R1;§2 核对表的删除范围)。"""
import pytest

from app.library import catalog_store, limits, paths
from app.models import utcnow
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.catalog_helpers import MEDIA, POSTER, data_dir_of, make_catalog, media_file
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, upload, use_fakes
from tests.test_admin_api import register


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True)}


async def _add(client, headers, cid) -> str:
    r = await client.post(f"/api/library/catalog/{cid}/add", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["item"]["id"]


async def test_ticket_and_range_work_on_the_shared_file(app, client):
    cid = await make_catalog(app)
    _uid, h = await register(client, "anna")
    item = await _add(client, h, cid)
    url = (await client.post(f"/api/library/items/{item}/media-ticket", headers=h)).json()["url"]
    full = await client.get(url)
    assert full.status_code == 200 and full.content == MEDIA and full.headers["content-type"] == "audio/mp4"
    part = await client.get(url, headers={"Range": "bytes=100-199"})
    assert part.status_code == 206 and part.content == MEDIA[100:200]
    assert (await client.get(f"/api/library/items/{item}/poster", headers=h)).content == POSTER
    _other, h2 = await register(client, "ben")
    assert (await client.post(f"/api/library/items/{item}/media-ticket", headers=h2)).status_code == 404


async def test_deleting_a_copy_never_deletes_the_shared_file(app, client):
    cid = await make_catalog(app)
    _a, ha = await register(client, "anna")
    _b, hb = await register(client, "ben")
    ia, ib = await _add(client, ha, cid), await _add(client, hb, cid)
    assert (await client.delete(f"/api/library/items/{ia}", headers=ha)).status_code == 200
    assert media_file(app, cid).read_bytes() == MEDIA
    url = (await client.post(f"/api/library/items/{ib}/media-ticket", headers=hb)).json()["url"]
    assert (await client.get(url)).status_code == 200


async def test_deleting_a_user_keeps_the_shared_file(app, client):
    cid = await make_catalog(app)
    uid, h = await register(client, "dora")
    await _add(client, h, cid)
    admin = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=admin, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=admin,
                             json={"confirm_username": "dora", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    assert media_file(app, cid).is_file()


async def test_copies_use_no_quota_and_do_not_count_as_items(app, client, monkeypatch):
    enable(monkeypatch)
    uid, h = await register(client, "anna")
    before = (await client.get("/api/library/config", headers=h)).json()["limits"]["used_bytes"]
    for _ in range(3):
        await _add(client, h, await make_catalog(app))
    assert (await client.get("/api/library/config", headers=h)).json()["limits"]["used_bytes"] == before == 0
    async with app.state.sessionmaker() as s:
        assert await limits.item_count(s, uid) == 0


async def test_copies_cannot_be_reprocessed_or_get_new_subtitles(app, client):
    cid = await make_catalog(app)
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        row.sub_source = "asr"
        await s.commit()
    _uid, h = await register(client, "anna")
    item = await _add(client, h, cid)
    locked = {"error": "Built-in items cannot be changed this way"}
    r = await client.post(f"/api/library/items/{item}/reprocess", headers=h)
    assert (r.status_code, r.json()) == (409, locked)
    r = await client.put(f"/api/library/items/{item}/subtitles", headers=h,
                         files={"file": ("t.srt", SRT, "application/x-subrip")})
    assert (r.status_code, r.json()) == (409, locked)
    assert (await client.post(f"/api/library/items/{item}/rebuild", headers=h)).json() == {
        "error": "Item cannot be rebuilt"}
    # the copy is still the user's own: title and sentence edits work
    assert (await client.patch(f"/api/library/items/{item}", headers=h, json={"title": "Mine"})).status_code == 200
    assert (await client.patch(f"/api/library/items/{item}/segments/0", headers=h,
                               json={"text": "Hello there, friend."})).status_code == 200
    assert media_file(app, cid).is_file()


async def test_deleting_the_last_copy_of_a_retired_item_collects_it(app, client):
    cid = await make_catalog(app)
    _uid, h = await register(client, "anna")
    item = await _add(client, h, cid)
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        row.published, row.retired_at = False, utcnow()
        await s.commit()
    url = (await client.post(f"/api/library/items/{item}/media-ticket", headers=h)).json()["url"]
    assert (await client.get(url)).status_code == 200  # a retired item keeps working for its copies
    await client.delete(f"/api/library/items/{item}", headers=h)
    assert not media_file(app, cid).exists()
    async with app.state.sessionmaker() as s:
        assert await catalog_store.get(s, cid) is None


async def test_the_daily_sweep_collects_retired_items_without_copies(app):
    cid = await make_catalog(app, retired=True)
    counts = await app.state.library.sweep(utcnow())
    assert counts == {"expired": 0, "purged": 0, "orphans": 0}  # the sweep's own numbers are unchanged (R-SC7)
    assert not media_file(app, cid).exists()


async def test_user_uploads_still_count_and_delete_their_own_dirs(app, client, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    uid, h = await register(client, "anna")
    mine = await upload(client, h, fake_media(), subs=SRT)
    await process(app)
    async with app.state.sessionmaker() as s:
        assert await limits.item_count(s, uid) == 1
    await client.delete(f"/api/library/items/{mine}", headers=h)
    assert not paths.item_dir(data_dir_of(app), uid, mine).exists()
