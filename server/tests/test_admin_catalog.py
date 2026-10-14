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


async def test_retry_cancel_and_translate(app, client, monkeypatch):
    import httpx
    import respx
    enable(monkeypatch)
    use_fakes(app)
    h = await login_as(app, client, "operator")
    cid = await upload_catalog(client, h, fake_media(6000))  # no subtitles, ASR off -> failed(no_subtitles)
    await drain_background(app)
    item = (await client.get(f"{BASE}/{cid}", headers=h)).json()["item"]
    assert (item["status"], item["error_kind"]) == ("failed", "no_subtitles")
    r = await client.put(f"{BASE}/uploads/{cid}/subtitles", headers=h,
                         files={"file": ("t.srt", SRT, "application/x-subrip")})
    assert r.status_code == 200
    await drain_background(app)
    assert (await client.get(f"{BASE}/{cid}", headers=h)).json()["item"]["status"] == "ready"
    assert (await client.post(f"{BASE}/{cid}/retry", headers=h, json={})).json() == {"error": "Item has not failed"}
    assert (await client.post(f"{BASE}/{cid}/cancel", headers=h, json={})).json() == {"error": "Item is not running"}
    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": True})
    with respx.mock:
        respx.post("https://llm.test/v1/chat/completions").mock(return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "1. 你好,我的朋友。\n2. 你今天好吗?"}}]}))
        assert (await client.post(f"{BASE}/{cid}/translate", headers=h, json={})).status_code == 200
        await drain_background(app)
    item = (await client.get(f"{BASE}/{cid}", headers=h)).json()["item"]
    assert (item["status"], item["translated"]) == ("ready", 2)
    await client.post(f"{BASE}/{cid}/publish", headers=h, json={})
    assert (await client.post(f"{BASE}/{cid}/translate", headers=h, json={})).json() == {"error": "Item is published"}


async def test_cancel_an_upload_removes_its_staging(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    r = await client.post(f"{BASE}/uploads", headers=h, json={"filename": "a.mp4", "size": 10})
    cid = r.json()["catalog_id"]
    r = await client.post(f"{BASE}/{cid}/cancel", headers=h, json={})
    assert r.json()["item"]["status"] == "canceled"
    assert not paths.catalog_tmp_dir(app.state.library.deps.data_dir, cid).exists()


async def test_segment_edits_only_while_unpublished(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app, published=False)
    r = await client.patch(f"{BASE}/{cid}/segments/0", headers=h, json={"text": "Hello there, my good friend."})
    seg = r.json()["segment"]
    assert seg["text"] == "Hello there, my good friend." and seg["zh"] is None  # stale translation cleared (R8)
    r = await client.patch(f"{BASE}/{cid}/segments/0", headers=h, json={"zh": "你好,我的好朋友。"})
    assert (r.json()["segment"]["zh"], r.json()["segment"]["zh_lang"]) == ("你好,我的好朋友。", "zh-CN")
    assert (await client.patch(f"{BASE}/{cid}/segments/0", headers=h, json={"end_ms": 3500})).json() == {
        "error": "Invalid sentence times"}  # overlaps sentence 1 (starts at 3200)
    assert (await client.patch(f"{BASE}/{cid}/segments/9", headers=h, json={"text": "x y"})).status_code == 404
    await client.post(f"{BASE}/{cid}/publish", headers=h, json={})
    assert (await client.patch(f"{BASE}/{cid}/segments/0", headers=h, json={"text": "Hi."})).json() == {
        "error": "Item is published"}


async def test_delete_without_copies_removes_everything(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app)
    r = await client.post(f"{BASE}/{cid}/delete", headers=h, json={"reason": "重复", "confirm": "nope"})
    assert r.status_code == 409 and r.json()["details"]["confirm"] == f"DELETE {cid[:8]}"
    r = await client.post(f"{BASE}/{cid}/delete", headers=h, json={"reason": "重复", "confirm": f"DELETE {cid[:8]}"})
    assert r.json() == {"id": cid, "outcome": "deleted", "refs": 0}
    assert not media_file(app, cid).exists()


async def test_delete_with_copies_retires_and_copies_keep_playing(app, client, monkeypatch):
    enable(monkeypatch)
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app)
    _uid, uh = await register(client, "anna")
    item = (await client.post(f"/api/library/catalog/{cid}/add", headers=uh)).json()["item"]["id"]
    r = await client.post(f"{BASE}/{cid}/delete", headers=h, json={"reason": "下线", "confirm": f"DELETE {cid[:8]}"})
    assert r.json() == {"id": cid, "outcome": "retired", "refs": 1}
    row = (await client.get(f"{BASE}/{cid}", headers=h)).json()["item"]
    assert (row["retired"], row["published"]) == (True, False)
    url = (await client.post(f"/api/library/items/{item}/media-ticket", headers=uh)).json()["url"]
    assert (await client.get(url)).status_code == 200
    assert (await client.post(f"{BASE}/{cid}/publish", headers=h, json={})).json() == {"error": "Item is retired"}
    await client.delete(f"/api/library/items/{item}", headers=uh)  # the last copy goes -> collected (SC)
    assert (await client.get(f"{BASE}/{cid}", headers=h)).status_code == 404


async def test_purge_needs_step_up_and_deletes_copies(app, client, monkeypatch):
    enable(monkeypatch)
    cid = await make_catalog(app)
    _uid, uh = await register(client, "anna")
    item = (await client.post(f"/api/library/catalog/{cid}/add", headers=uh)).json()["item"]["id"]
    op = await login_as(app, client, "operator")
    body = {"reason": "版权投诉", "confirm": f"PURGE {cid[:8]}"}
    assert (await client.post(f"{BASE}/{cid}/purge", headers=op, json=body)).status_code == 403
    su = await login_as(app, client, "superadmin")
    assert (await client.post(f"{BASE}/{cid}/purge", headers=su, json=body)).status_code == 403  # no step-up yet
    await client.post("/api/admin/step-up", headers=su, json={"password": PASSWORD})
    r = await client.post(f"{BASE}/{cid}/purge", headers=su, json=body)
    assert r.json() == {"id": cid, "copies_deleted": 1, "users": 1}
    assert (await client.get(f"/api/library/items/{item}", headers=uh)).status_code == 404
    assert not media_file(app, cid).exists()
    audits = {a.action: a for a in await _audits(app)}
    assert audits["catalog.purge"].after == {"copies": 1, "users": 1}


async def test_admin_logs_and_audit_carry_no_titles_or_text(app, client, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    enable(monkeypatch)
    use_fakes(app)
    h = await login_as(app, client, "operator")
    cid = await upload_catalog(client, h, fake_media(6000), subs=SRT.replace(b"Hello", b"SECRET-SUB"),
                               title="SECRET-TITLE", license_note="SECRET-LICENSE")
    await drain_background(app)
    await client.patch(f"{BASE}/{cid}", headers=h, json={"title": "SECRET-TITLE 2"})
    await client.patch(f"{BASE}/{cid}/segments/0", headers=h, json={"text": "SECRET-EDIT words", "zh": "SECRET-ZH"})
    await client.post(f"{BASE}/{cid}/delete", headers=h, json={"reason": "r", "confirm": f"DELETE {cid[:8]}"})
    text = " ".join(f"{r.getMessage()} {r.args!r}" for r in caplog.records)
    assert "SECRET" not in text
    for a in await _audits(app):
        assert "SECRET" not in f"{a.summary} {a.before} {a.after}"


def test_catalog_admin_urls_carry_only_ids():
    from app.main import create_app
    from tests.conftest import make_settings
    from tests.test_admin_routes_guarded import api_routes
    found = sorted({p for p, _ in api_routes(create_app(make_settings()).routes) if p.startswith(BASE)})
    assert found == sorted([BASE, f"{BASE}/{{catalog_id}}", f"{BASE}/imports", f"{BASE}/uploads",
                            f"{BASE}/uploads/{{catalog_id}}/chunks/{{n}}", f"{BASE}/uploads/{{catalog_id}}/subtitles",
                            f"{BASE}/uploads/{{catalog_id}}/complete", f"{BASE}/{{catalog_id}}/publish",
                            f"{BASE}/{{catalog_id}}/unpublish", f"{BASE}/{{catalog_id}}/retry",
                            f"{BASE}/{{catalog_id}}/cancel", f"{BASE}/{{catalog_id}}/translate",
                            f"{BASE}/{{catalog_id}}/segments/{{idx}}", f"{BASE}/{{catalog_id}}/delete",
                            f"{BASE}/{{catalog_id}}/purge", f"{BASE}/{{catalog_id}}/media",
                            f"{BASE}/{{catalog_id}}/poster"])
