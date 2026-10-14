"""管理端精选库(spec 2026-10-14-curated-library §9、R1;INDEX §6)。"""
import logging

import pytest
from sqlalchemy import select

from app.core import config as config_module
from app.library import paths
from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.background import drain_background
from tests.catalog_helpers import make_catalog, media_file
from tests.library_helpers import SRT, enable, fake_media, library_settings, use_fakes
from tests.test_admin_api import register
from tests.test_library_catalog_import import FakeFetch

BASE = "/api/admin/library/catalog"


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True,
                                                library_ytdlp_proxy="http://proxy.invalid:3128")}


async def upload_catalog(client, h, data: bytes, *, subs: bytes | None = None, **meta) -> str:
    r = await client.post(f"{BASE}/uploads", headers=h, json={"filename": "Talk.mp4", "size": len(data), **meta})
    assert r.status_code == 200, r.text
    cid, size = r.json()["catalog_id"], r.json()["chunk_bytes"]
    for n in range(max(1, (len(data) + size - 1) // size)):
        r = await client.put(f"{BASE}/uploads/{cid}/chunks/{n}", headers=h,
                             files={"chunk": ("blob", data[n * size:(n + 1) * size], "application/octet-stream")})
        assert r.status_code == 200, r.text
    if subs is not None:
        r = await client.put(f"{BASE}/uploads/{cid}/subtitles", headers=h,
                             files={"file": ("t.srt", subs, "application/x-subrip")})
        assert r.status_code == 200, r.text
    r = await client.post(f"{BASE}/uploads/{cid}/complete", headers=h)
    assert r.status_code == 200, r.text
    return cid


async def _audits(app):
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all())


async def test_state_and_roles(app, client, monkeypatch):
    enable(monkeypatch)
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: True)
    h = await login_as(app, client, "viewer")
    r = await client.get(BASE, headers=h)
    assert r.status_code == 200
    state = r.json()["state"]
    assert state["enabled"] is True and state["available"] is True and state["link"] is True
    assert state["proxy_configured"] is True and "zh-CN" in state["languages"] and state["chunk_bytes"] == 8388608
    assert (await client.post(f"{BASE}/imports", headers=h, json={"url": "https://x.invalid/a"})).status_code == 403


async def test_upload_runs_to_a_ready_unpublished_item_then_publish(app, client, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    h = await login_as(app, client, "operator")
    cid = await upload_catalog(client, h, fake_media(6000), subs=SRT, title="Talk one", level="b1",
                               tags=["News"], license_note="VOA Learning English · Public domain")
    await drain_background(app)
    detail = (await client.get(f"{BASE}/{cid}", headers=h)).json()
    item = detail["item"]
    assert (item["status"], item["published"], item["level"], item["tags"], item["seg_count"]) == (
        "ready", False, "B1", ["News"], 2)
    assert [s["text"] for s in detail["segments"]] == ["Hello there, my friend.", "How are you doing today?"]
    r = await client.post(f"{BASE}/{cid}/publish", headers=h, json={})
    assert r.status_code == 200 and r.json()["item"]["published"] is True
    _uid, uh = await register(client, "anna")
    assert [c["id"] for c in (await client.get("/api/library/catalog", headers=uh)).json()["items"]] == [cid]
    r = await client.post(f"{BASE}/{cid}/unpublish", headers=h, json={})
    assert r.json()["item"]["published"] is False
    assert (await client.get("/api/library/catalog", headers=uh)).json()["items"] == []
    actions = [a.action for a in (await _audits(app))]
    assert {"catalog.upload", "catalog.publish", "catalog.unpublish"} <= set(actions)


async def test_link_import_runs_with_the_user_switch_off(app, client, monkeypatch):
    enable(monkeypatch)
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: True)
    use_fakes(app)
    app.state.library.set_fetch_stage(FakeFetch(fake_media(6000), subs=SRT))
    assert app.state.settings.library_link_import_enabled is False
    h = await login_as(app, client, "operator")
    r = await client.post(f"{BASE}/imports", headers=h,
                          json={"url": "看这个 https://learningenglish.voanews.com/a/7000000.html 好", "tags": []})
    assert r.status_code == 200, r.text
    cid = r.json()["item"]["id"]
    await drain_background(app)
    item = (await client.get(f"{BASE}/{cid}", headers=h)).json()["item"]
    assert (item["status"], item["source"], item["title"], item["sub_source"]) == (
        "ready", "link", "Page title", "platform")
    assert (await client.post(f"{BASE}/imports", headers=h, json={"url": "file:///etc/passwd"})).json() == {
        "error": "Invalid link"}
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: False)
    r = await client.post(f"{BASE}/imports", headers=h, json={"url": "https://learningenglish.voanews.com/a/1.html"})
    assert (r.status_code, r.json()) == (503, {"error": "Link import is unavailable"})


async def test_metadata_validation_and_edits(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app, published=False)
    r = await client.patch(f"{BASE}/{cid}", headers=h, json={"title": "  New  title ", "level": None,
                                                             "tags": ["a", "b"], "license_note": "TED · CC BY-NC-ND 4.0"})
    item = r.json()["item"]
    assert (item["title"], item["level"], item["tags"], item["license_note"]) == (
        "New title", None, ["a", "b"], "TED · CC BY-NC-ND 4.0")
    assert (await client.patch(f"{BASE}/{cid}", headers=h, json={"level": "Z9"})).status_code == 400
    assert (await client.patch(f"{BASE}/{cid}", headers=h, json={"tags": list("abcdef")})).status_code == 400
    assert (await client.post(f"{BASE}/uploads", headers=h, json={"filename": "a.exe", "size": 10})).json() == {
        "error": "Unsupported file type"}


async def test_publish_needs_a_ready_item_with_media(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    busy = await make_catalog(app, status="processing", published=False)
    gone = await make_catalog(app, published=False, with_files=False)
    assert (await client.post(f"{BASE}/{busy}/publish", headers=h, json={})).json() == {"error": "Item is not ready"}
    assert (await client.post(f"{BASE}/{gone}/publish", headers=h, json={})).json() == {"error": "Media is missing"}
    assert (await client.get(f"{BASE}/{gone}", headers=h)).json()["item"]["media_missing"] is True


async def test_admin_media_plays_with_the_cookie_and_supports_range(app, client, monkeypatch):
    enable(monkeypatch)
    await login_as(app, client, "viewer")
    cid = await make_catalog(app)
    r = await client.get(f"{BASE}/{cid}/media", headers={"Range": "bytes=0-9"})
    assert r.status_code == 206 and len(r.content) == 10
    assert (await client.get(f"{BASE}/{cid}/poster")).status_code == 200
