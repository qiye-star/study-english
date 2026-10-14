"""用户侧精选库接口(spec 2026-10-14-curated-library §9;INDEX §6)。"""
import pytest

from tests.catalog_helpers import POSTER, make_catalog
from tests.library_helpers import enable, library_settings
from tests.test_admin_api import register


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_catalog_enabled=True)


async def test_config_reports_the_catalog_switch(app, client, auth_headers, monkeypatch):
    enable(monkeypatch)
    assert (await client.get("/api/library/config", headers=auth_headers)).json()["catalog"] is True
    app.state.settings = app.state.settings.model_copy(update={"library_catalog_enabled": False})
    assert (await client.get("/api/library/config", headers=auth_headers)).json()["catalog"] is False


async def test_list_add_twice_and_poster(app, client, auth_headers):
    cid = await make_catalog(app)
    r = await client.get("/api/library/catalog", headers=auth_headers)
    assert r.status_code == 200
    (card,) = r.json()["items"]
    assert card["id"] == cid and card["added_item_id"] is None and card["tags"] == ["news", "science"]
    first = await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)
    assert first.status_code == 200 and first.json()["created"] is True
    item = first.json()["item"]
    assert (item["source"], item["catalog_id"], item["library_bytes"], item["status"]) == ("catalog", cid, 0, "ready")
    second = await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)
    assert second.json() == {"item": second.json()["item"], "created": False}
    assert second.json()["item"]["id"] == item["id"]
    assert (await client.get("/api/library/catalog", headers=auth_headers)).json()["items"][0]["added_item_id"] == item["id"]
    poster = await client.get(f"/api/library/catalog/{cid}/poster", headers=auth_headers)
    assert poster.status_code == 200 and poster.content == POSTER and poster.headers["content-type"] == "image/jpeg"
    detail = (await client.get(f"/api/library/items/{item['id']}", headers=auth_headers)).json()
    assert [s["zh"] for s in detail["segments"]] == ["你好,我的朋友。", "你今天好吗?"]


async def test_each_user_gets_their_own_copy(app, client):
    cid = await make_catalog(app)
    _a, ha = await register(client, "anna")
    _b, hb = await register(client, "ben")
    ia = (await client.post(f"/api/library/catalog/{cid}/add", headers=ha)).json()["item"]["id"]
    ib = (await client.post(f"/api/library/catalog/{cid}/add", headers=hb)).json()["item"]["id"]
    assert ia != ib
    assert (await client.get(f"/api/library/items/{ia}", headers=hb)).status_code == 404


async def test_switches_and_unknown_items(app, client, auth_headers):
    cid = await make_catalog(app)
    draft = await make_catalog(app, published=False)
    assert (await client.post(f"/api/library/catalog/{draft}/add", headers=auth_headers)).json() == {
        "error": "Built-in item not found"}
    assert (await client.get(f"/api/library/catalog/{draft}/poster", headers=auth_headers)).status_code == 404
    assert (await client.post("/api/library/catalog/nope/add", headers=auth_headers)).status_code == 404
    assert (await client.get("/api/library/catalog")).status_code == 401
    app.state.settings = app.state.settings.model_copy(update={"library_catalog_enabled": False})
    r = await client.get("/api/library/catalog", headers=auth_headers)
    assert (r.status_code, r.json()) == (404, {"error": "Built-in library is disabled"})
    assert (await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)).status_code == 404
    app.state.settings = app.state.settings.model_copy(update={"library_enabled": False})
    assert (await client.get("/api/library/catalog", headers=auth_headers)).json() == {"error": "Library is disabled"}


async def test_copies_keep_working_when_the_catalog_switch_is_off(app, client, auth_headers):
    cid = await make_catalog(app)
    item = (await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)).json()["item"]
    app.state.settings = app.state.settings.model_copy(update={"library_catalog_enabled": False})
    assert (await client.get(f"/api/library/items/{item['id']}", headers=auth_headers)).status_code == 200


async def test_add_is_free_of_the_daily_import_counter_and_item_cap(app, client, auth_headers):
    app.state.settings = app.state.settings.model_copy(update={"library_imports_daily_per_user": 0,
                                                               "library_max_items": 1})
    for _ in range(2):
        cid = await make_catalog(app)
        assert (await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)).status_code == 200
