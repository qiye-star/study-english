"""更新日志管理端(计划 2026-10-14-changelog S3;spec §2.1、D6):校验、状态流转、角色、审计(只记 id 与动作)。"""
import pytest
from sqlalchemy import select

from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, login_as

URL = "/api/admin/changelog"
MARK = "ZQMARKER-ADMIN"


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED}


def body(**over) -> dict:
    base = {"entry_date": "2026-10-14", "version": None, "title_zh": "标题", "title_en": "",
            "items": [{"tag": "new", "zh": "一句话", "en": ""}]}
    return {**base, **over}


async def audits(app) -> list[AdminAudit]:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AdminAudit).where(AdminAudit.action.like("changelog.%")).order_by(AdminAudit.id))).all())


async def test_create_edit_publish_unpublish_delete_and_the_audit_trail(app, client):
    h = await login_as(app, client, "operator")
    r = await client.post(URL, headers=h, json=body(version="  v1.12 ", title_zh="  标题  ", title_en="Title"))
    assert r.status_code == 201, r.text
    entry = r.json()
    assert set(entry) == {"id", "status", "entry_date", "version", "title_zh", "title_en", "items", "created_by",
                          "created_at", "updated_at", "published_at"}
    assert entry["status"] == "draft" and entry["published_at"] is None and entry["created_by"] == "operator1"
    assert entry["version"] == "v1.12" and entry["title_zh"] == "标题" and entry["entry_date"] == "2026-10-14"
    eid = entry["id"]

    r = await client.patch(f"{URL}/{eid}", headers=h, json={"title_en": "New title", "version": None,
                                                           "items": [{"tag": "fix", "zh": "修好了", "en": "Fixed"}]})
    assert r.status_code == 200, r.text
    assert r.json()["version"] is None and r.json()["title_en"] == "New title" and r.json()["title_zh"] == "标题"
    assert r.json()["items"] == [{"tag": "fix", "zh": "修好了", "en": "Fixed"}]

    r = await client.post(f"{URL}/{eid}/publish", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "published" and r.json()["published_at"]
    assert (await client.post(f"{URL}/{eid}/publish", headers=h)).status_code == 200  # idempotent: no second audit row
    r = await client.post(f"{URL}/{eid}/unpublish", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "draft" and r.json()["published_at"] is None
    assert (await client.post(f"{URL}/{eid}/unpublish", headers=h)).status_code == 200
    r = await client.delete(f"{URL}/{eid}", headers=h)
    assert r.status_code == 200 and r.json() == {"id": eid, "deleted": True}

    rows = await audits(app)
    assert [a.action for a in rows] == ["changelog.create", "changelog.update", "changelog.publish",
                                        "changelog.unpublish", "changelog.delete"]
    for a in rows:
        assert (a.target_type, a.target_id, a.summary, a.before, a.after, a.reason) == ("changelog", str(eid), "", None, None, None)
        assert a.actor == "operator1" and a.result == "ok"


async def test_deleted_entries_are_gone_and_cannot_be_changed(app, client):
    h = await login_as(app, client, "operator")
    eid = (await client.post(URL, headers=h, json=body())).json()["id"]
    await client.delete(f"{URL}/{eid}", headers=h)
    assert (await client.get(URL)).json() == {"entries": []}
    for call in (client.patch(f"{URL}/{eid}", headers=h, json={"title_zh": "x"}), client.post(f"{URL}/{eid}/publish", headers=h),
                 client.post(f"{URL}/{eid}/unpublish", headers=h), client.delete(f"{URL}/{eid}", headers=h)):
        assert (await call).status_code == 404
    assert (await client.patch(f"{URL}/999", headers=h, json={"title_zh": "x"})).status_code == 404


async def test_listing_has_drafts_and_published_newest_date_first(app, client):
    h = await login_as(app, client, "operator")
    a = (await client.post(URL, headers=h, json=body(entry_date="2026-10-12", title_zh="A"))).json()["id"]
    b = (await client.post(URL, headers=h, json=body(entry_date="2026-10-14", title_zh="B"))).json()["id"]
    await client.post(f"{URL}/{a}/publish", headers=h)
    listed = (await client.get(URL)).json()["entries"]
    assert [(e["id"], e["status"]) for e in listed] == [(b, "draft"), (a, "published")]


async def test_roles_viewer_reads_operator_writes_and_a_visitor_gets_nothing(app, client):
    assert (await client.post(URL, json=body())).status_code in (401, 403)  # no session at all
    await login_as(app, client, "viewer")
    assert (await client.get(URL)).status_code == 200
    r = await client.post(URL, headers={"X-Admin-CSRF": "x"}, json=body())
    assert r.status_code == 403
    client.cookies.clear()
    assert (await client.get(URL)).status_code in (401, 403)
    h = await login_as(app, client, "operator")
    assert (await client.post(URL, headers=h, json=body())).status_code == 201


BAD = [
    ({}, {"entry_date", "title_zh", "items"}),
    (body(entry_date="2026-13-40"), {"entry_date"}),
    (body(entry_date="20261014"), {"entry_date"}),
    (body(entry_date="2026-W42-1"), {"entry_date"}),
    (body(title_zh="   "), {"title_zh"}),
    (body(title_zh="题" * 81), {"title_zh"}),
    (body(title_en="t" * 81), {"title_en"}),
    (body(version="v 1"), {"version"}),
    (body(version="v" * 25), {"version"}),
    (body(items=[]), {"items"}),
    (body(items=[{"tag": "new", "zh": "x", "en": ""}] * 21), {"items"}),
    (body(items=[{"tag": "wow", "zh": "x", "en": ""}]), {"items.0.tag"}),
    (body(items=[{"tag": "new", "zh": "", "en": ""}]), {"items.0.zh"}),
    (body(items=[{"tag": "new", "zh": "字" * 201, "en": ""}]), {"items.0.zh"}),
    (body(items=[{"tag": "new", "zh": "x", "en": "e" * 201}]), {"items.0.en"}),
    (body(items=[{"tag": "new", "zh": "x", "en": "", "extra": 1}]), {"items.0"}),
    (body(items=[{"tag": "new", "zh": "ok", "en": ""}, {"tag": "fix", "zh": "", "en": ""}]), {"items.1.zh"}),
]


@pytest.mark.parametrize("payload, keys", BAD)
async def test_validation_names_the_keys_and_never_echoes_text(app, client, payload, keys):
    h = await login_as(app, client, "operator")
    r = await client.post(URL, headers=h, json=payload)
    assert r.status_code == 422, r.text
    assert r.json()["error"] == "Invalid changelog entry" and set(r.json()["fields"]) == keys
    assert (await client.get(URL)).json() == {"entries": []}  # nothing was written


async def test_validation_errors_do_not_echo_the_offending_text(app, client):
    h = await login_as(app, client, "operator")
    r = await client.post(URL, headers=h, json=body(items=[{"tag": "new", "zh": MARK * 40, "en": ""}]))
    assert r.status_code == 422 and MARK not in r.text
    r = await client.post(URL, headers=h, json=body(items=[{"tag": MARK, "zh": "x", "en": "", MARK: 1}]))
    assert r.status_code == 422 and MARK not in r.text
    r = await client.post(URL, headers=h, json={**body(), MARK: 1})  # unknown top-level key: pydantic, field name only
    assert r.status_code == 422


async def test_accepts_the_edges_and_other_tags(app, client):
    h = await login_as(app, client, "operator")
    items = [{"tag": t, "zh": "字" * 200, "en": "e" * 200} for t in ("new", "improve", "fix", "library", "other")] * 4
    r = await client.post(URL, headers=h, json=body(title_zh="题" * 80, title_en="t" * 80, version="1.0.0-rc.1", items=items))
    assert r.status_code == 201 and len(r.json()["items"]) == 20
    r = await client.post(URL, headers=h, json=body(items=[{"tag": "other", "zh": "x"}]))  # `en` may be left out
    assert r.status_code == 201 and r.json()["items"] == [{"tag": "other", "zh": "x", "en": ""}]


async def test_patch_validates_the_merged_entry(app, client):
    h = await login_as(app, client, "operator")
    eid = (await client.post(URL, headers=h, json=body())).json()["id"]
    r = await client.patch(f"{URL}/{eid}", headers=h, json={"items": []})
    assert r.status_code == 422 and set(r.json()["fields"]) == {"items"}
    assert (await client.patch(f"{URL}/{eid}", headers=h, json={"entry_date": "2026-10-15"})).json()["entry_date"] == "2026-10-15"


async def test_publishing_reaches_users_and_unpublishing_hides_it_again(app, client, auth_headers):
    h = await login_as(app, client, "operator")
    eid = (await client.post(URL, headers=h, json=body())).json()["id"]
    assert (await client.get("/api/changelog", headers=auth_headers)).json()["entries"] == []
    await client.post(f"{URL}/{eid}/publish", headers=h)
    page = (await client.get("/api/changelog", headers=auth_headers)).json()
    assert [e["id"] for e in page["entries"]] == [eid] and page["latest_id"] == eid and page["unread"] == 1
    await client.post(f"{URL}/{eid}/unpublish", headers=h)
    page = (await client.get("/api/changelog", headers=auth_headers)).json()
    assert page["entries"] == [] and page["latest_id"] is None
