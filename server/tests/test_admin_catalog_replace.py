"""替换精选条目的媒体(plan 2026-10-15-catalog-keep-video R-KV5–R-KV9)。假工具,不联网。"""
import logging

import pytest
from sqlalchemy import select

from app.library import catalog_import, paths
from app.models import AdminAudit, CatalogItem
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.background import drain_background
from tests.library_helpers import SRT, enable, fake_media, library_settings, use_fakes
from tests.test_admin_api import register
from tests.test_admin_catalog import BASE, upload_catalog


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True)}


async def replace_media(client, h, cid: str, data: bytes, *, filename: str = "Talk.mp4") -> None:
    r = await client.post(f"{BASE}/{cid}/replace-media", headers=h, json={"filename": filename, "size": len(data)})
    assert r.status_code == 200, r.text
    assert r.json()["catalog_id"] == cid
    size = r.json()["chunk_bytes"]
    for n in range(max(1, (len(data) + size - 1) // size)):
        r = await client.put(f"{BASE}/uploads/{cid}/chunks/{n}", headers=h,
                             files={"chunk": ("blob", data[n * size:(n + 1) * size], "application/octet-stream")})
        assert r.status_code == 200, r.text
    r = await client.post(f"{BASE}/uploads/{cid}/complete", headers=h)
    assert r.status_code == 200, r.text


async def old_audio_item_with_a_copy(app, client, monkeypatch):
    """An item from before this plan (audio source -> media.m4a), published, added by one user, then unpublished."""
    enable(monkeypatch)
    tools = use_fakes(app)
    h = await login_as(app, client, "operator")
    cid = await upload_catalog(client, h, fake_media(6000, video=False), subs=SRT)
    await drain_background(app)
    assert (await client.post(f"{BASE}/{cid}/publish", headers=h, json={})).status_code == 200
    _uid, uh = await register(client, "anna")
    copy = (await client.post(f"/api/library/catalog/{cid}/add", headers=uh)).json()["item"]
    assert copy["kind"] == "audio"
    assert (await client.post(f"{BASE}/{cid}/unpublish", headers=h, json={})).status_code == 200
    return tools, h, uh, cid, copy["id"]


async def _row(app, cid) -> CatalogItem:
    async with app.state.sessionmaker() as s:
        return await s.get(CatalogItem, cid)


def _data_dir(app):
    return app.state.library.deps.data_dir


async def test_replacing_with_the_video_keeps_sentences_and_moves_every_copy(app, client, monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    tools, h, uh, cid, item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    before = (await client.get(f"{BASE}/{cid}", headers=h)).json()
    old = paths.catalog_dir(_data_dir(app), cid) / "media.m4a"
    assert old.is_file()
    await replace_media(client, h, cid, fake_media(6100, video=True))
    await drain_background(app)
    after = (await client.get(f"{BASE}/{cid}", headers=h)).json()
    assert (after["item"]["status"], after["item"]["kind"], after["item"]["error_kind"]) == ("ready", "video", None)
    assert after["item"]["published"] is False and after["segments"] == before["segments"]
    assert tools.normalize_kwargs["max_kbps"] == catalog_import.VIDEO_MAX_KBPS
    row = await _row(app, cid)
    assert (row.media_path, row.media_mime, row.duration_ms) == (
        f"{paths.catalog_rel(cid)}/media.mp4", "video/mp4", 6100)
    assert row.poster_path == f"{paths.catalog_rel(cid)}/poster.jpg"
    assert not old.exists() and not paths.catalog_tmp_dir(_data_dir(app), cid).exists()
    copy = (await client.get(f"/api/library/items/{item}", headers=uh)).json()["item"]
    assert (copy["kind"], copy["library_bytes"], copy["catalog_id"], copy["duration_ms"]) == ("video", 0, cid, 6100)
    url = (await client.post(f"/api/library/items/{item}/media-ticket", headers=uh)).json()["url"]
    r = await client.get(url, headers={"Range": "bytes=0-9"})
    assert r.status_code == 206 and r.headers["content-type"] == "video/mp4"
    async with app.state.sessionmaker() as s:
        audits = [a for a in (await s.scalars(select(AdminAudit))).all() if a.action == "catalog.replace_media"]
    assert len(audits) == 1 and audits[0].target_id == cid
    ours = " | ".join(r.getMessage() for r in caplog.records if not r.name.startswith("httpx"))  # httpx logs the test's own URLs
    assert "library catalog media replaced" in ours and "Talk.mp4" not in ours and "ticket=" not in ours


async def test_a_second_replace_never_overwrites_the_file_in_use(app, client, monkeypatch):
    _tools, h, _uh, cid, _item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    for _ in range(2):
        await replace_media(client, h, cid, fake_media(6000, video=True))
        await drain_background(app)
    row = await _row(app, cid)
    folder = paths.catalog_dir(_data_dir(app), cid)
    assert row.media_path.endswith("/media-2.mp4")
    assert sorted(p.name for p in folder.iterdir()) == ["media-2.mp4", "poster.jpg"]


async def test_a_different_duration_fails_back_to_ready_and_changes_nothing(app, client, monkeypatch):
    _tools, h, uh, cid, item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    await replace_media(client, h, cid, fake_media(20_000, video=True))
    await drain_background(app)
    row = await _row(app, cid)
    assert (row.status, row.error_kind, row.media_mime, row.seg_count) == ("ready", "unsupported_format", "audio/mp4", 2)
    assert row.media_path.endswith("/media.m4a") and paths.absolute(_data_dir(app), row.media_path).is_file()
    assert not paths.catalog_tmp_dir(_data_dir(app), cid).exists()
    assert (await client.get(f"/api/library/items/{item}", headers=uh)).json()["item"]["kind"] == "audio"


async def test_replace_refusals(app, client, monkeypatch):
    _tools, h, _uh, cid, _item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    url = f"{BASE}/{cid}/replace-media"
    assert (await client.post(f"{BASE}/{cid}/publish", headers=h, json={})).status_code == 200
    r = await client.post(url, headers=h, json={"filename": "a.mp4", "size": 10})
    assert (r.status_code, r.json()) == (409, {"error": "Item is published"})
    await client.post(f"{BASE}/{cid}/unpublish", headers=h, json={})
    r = await client.post(url, headers=h, json={"filename": "a.exe", "size": 10})
    assert (r.status_code, r.json()) == (400, {"error": "Unsupported file type"})
    assert (await client.post(url, headers=h, json={"filename": "a.mp4", "size": 10})).status_code == 200
    r = await client.put(f"{BASE}/uploads/{cid}/subtitles", headers=h,
                         files={"file": ("t.srt", SRT, "application/x-subrip")})
    assert r.status_code == 200, r.text  # plan 2026-10-27 R-S4: a replacement may carry subtitles now
    r = await client.post(url, headers=h, json={"filename": "a.mp4", "size": 10})
    assert (r.status_code, r.json()) == (409, {"error": "Item is not ready"})
    await client.post(f"{BASE}/{cid}/cancel", headers=h, json={})
    r = await client.put(f"{BASE}/uploads/{cid}/subtitles", headers=h,
                         files={"file": ("t.srt", SRT, "application/x-subrip")})
    assert (r.status_code, r.json()) == (409, {"error": "Subtitles cannot be changed now"})  # ready: refused


async def test_canceling_a_replace_upload_goes_back_to_ready_with_the_old_media(app, client, monkeypatch):
    _tools, h, _uh, cid, _item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    assert (await client.post(f"{BASE}/{cid}/replace-media", headers=h,
                              json={"filename": "a.mp4", "size": 10})).status_code == 200
    assert (await _row(app, cid)).status == "uploading"
    r = await client.post(f"{BASE}/{cid}/cancel", headers=h, json={})
    assert r.status_code == 200 and r.json()["item"]["status"] == "ready"
    row = await _row(app, cid)
    assert row.media_path.endswith("/media.m4a") and paths.absolute(_data_dir(app), row.media_path).is_file()
    assert not paths.catalog_tmp_dir(_data_dir(app), cid).exists()


async def test_a_translate_rerun_without_the_mark_does_not_touch_the_media(app, client, monkeypatch):
    tools, h, _uh, cid, _item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    calls = len(tools.calls)
    async with app.state.sessionmaker() as s:  # what the admin "translate" action does, AI being off here
        row = await s.get(CatalogItem, cid)
        row.status = "queued"
        await s.commit()
    await app.state.catalog.run_once()
    await drain_background(app)
    assert (await _row(app, cid)).media_path.endswith("/media.m4a")
    assert "normalize" not in tools.calls[calls:] and "probe" not in tools.calls[calls:]
