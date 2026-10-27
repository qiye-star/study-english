"""管理端精选库的导入包支持(plan 2026-10-27-library-local-export-cloud-import R-S2、R-S3):上传开始可带 source_md5,
同 md5 的未退役条目重复拦截(409),包检查端点只读。md5 只出现在请求体与回包里,不进日志、审计、管理端输出、副本。"""
import logging
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models import AdminAudit, CatalogItem, utcnow
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.background import drain_background
from tests.catalog_helpers import make_catalog
from tests.library_helpers import enable, library_settings
from tests.test_admin_api import register

BASE = "/api/admin/library/catalog"
MD5_A = "0123456789abcdef0123456789abcdef"
MD5_B = "fedcba9876543210fedcba9876543210"
MD5_C = "00000000000000000000000000000001"
SECRET_TITLE = "SECRET-TITLE package talk"


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True)}


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def _start(client, h, *, source_md5=None, title=SECRET_TITLE, size=1000):
    body = {"filename": "Talk.mp4", "size": size, "title": title}
    if source_md5 is not None:
        body["source_md5"] = source_md5
    return await client.post(f"{BASE}/uploads", headers=h, json=body)


async def _set(app, cid: str, **values) -> None:
    async with app.state.sessionmaker() as s:
        row = await s.get(CatalogItem, cid)
        for key, value in values.items():
            setattr(row, key, value)
        await s.commit()


async def _rows(app, md5: str) -> list[CatalogItem]:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(CatalogItem).where(CatalogItem.source_md5 == md5))).all())


async def _audits(app) -> list[AdminAudit]:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all())


# ---- R-S2: upload start with source_md5 ----

async def test_start_with_a_valid_md5_stores_it_and_no_list_or_detail_payload_shows_it(app, client):
    h = await login_as(app, client, "operator")
    r = await _start(client, h, source_md5=MD5_A)
    assert r.status_code == 200, r.text
    cid = r.json()["catalog_id"]
    assert [row.id for row in await _rows(app, MD5_A)] == [cid]
    listing = (await client.get(BASE, headers=h)).text
    detail = (await client.get(f"{BASE}/{cid}", headers=h)).text
    assert "source_md5" not in listing and "source_md5" not in detail
    assert MD5_A not in listing and MD5_A not in detail


@pytest.mark.parametrize("bad", ["0123456789abcdef0123456789abcde", "0123456789ABCDEF0123456789ABCDEF",
                                 "0123456789abcdef0123456789abcdeg", "", "x" * 32 + "0"])
async def test_a_malformed_md5_is_rejected_before_anything_is_created(app, client, bad):
    h = await login_as(app, client, "operator")
    r = await _start(client, h, source_md5=bad)
    assert r.status_code == 422
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(CatalogItem))).all() == []


async def test_without_source_md5_the_upload_is_as_before_and_the_row_has_none(app, client):
    h = await login_as(app, client, "operator")
    r = await _start(client, h)
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"catalog_id", "chunk_bytes"}
    async with app.state.sessionmaker() as s:
        row = await s.get(CatalogItem, r.json()["catalog_id"])
        assert row.source_md5 is None
    audit = [a for a in await _audits(app) if a.action == "catalog.upload"][-1]
    assert audit.after == {"bytes": 1000}  # no package flag without a package


async def test_a_package_upload_is_marked_in_the_audit_without_the_md5(app, client):
    h = await login_as(app, client, "operator")
    assert (await _start(client, h, source_md5=MD5_A)).status_code == 200
    audit = [a for a in await _audits(app) if a.action == "catalog.upload"][-1]
    assert audit.after == {"bytes": 1000, "package": True}
    assert MD5_A not in str(audit.before) + str(audit.after) + audit.summary


# ---- R-S2: duplicate interception ----

@pytest.mark.parametrize("status", ["uploading", "queued", "processing", "ready"])
async def test_an_active_or_ready_item_with_the_same_md5_blocks_a_second_import(app, client, status):
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app)
    await _set(app, cid, source_md5=MD5_A, status=status, published=False)
    before = len(await _rows(app, MD5_A))
    r = await _start(client, h, source_md5=MD5_A)
    assert r.status_code == 409, r.text
    assert r.json() == {"error": "Item already imported"}
    assert len(await _rows(app, MD5_A)) == before  # nothing was created


async def test_double_start_in_a_row_is_refused_by_the_first_uploading_row(app, client):
    h = await login_as(app, client, "operator")
    assert (await _start(client, h, source_md5=MD5_A)).status_code == 200
    assert (await _start(client, h, source_md5=MD5_A)).status_code == 409
    assert len(await _rows(app, MD5_A)) == 1


@pytest.mark.parametrize("status,retired", [("failed", False), ("canceled", False), ("ready", True)])
async def test_failed_canceled_or_retired_rows_do_not_block(app, client, status, retired):
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app, published=False, retired=retired)
    await _set(app, cid, source_md5=MD5_A, status=status)
    r = await _start(client, h, source_md5=MD5_A)
    assert r.status_code == 200, r.text
    assert len(await _rows(app, MD5_A)) == 2


# ---- R-S3: package check ----

async def test_check_returns_only_requested_md5s_newest_first_with_the_fields_of_r_s3(app, client):
    h = await login_as(app, client, "operator")
    now = utcnow()
    old = await make_catalog(app, title="Old attempt", published=False, segments=[(0, 1000, "One.", None)])
    await _set(app, old, source_md5=MD5_A, status="failed", created_at=now - timedelta(days=2))
    new = await make_catalog(app, title="New ready", published=True)
    await _set(app, new, source_md5=MD5_A, created_at=now - timedelta(days=1))
    other = await make_catalog(app, title="Not asked")
    await _set(app, other, source_md5=MD5_B)
    r = await client.post(f"{BASE}/packages/check", headers=h, json={"source_md5s": [MD5_A, MD5_C]})
    assert r.status_code == 200, r.text
    matches = r.json()["matches"]
    assert [m["catalog_id"] for m in matches] == [new, old]  # newest first, both rows of MD5_A
    assert set(matches[0]) == {"source_md5", "catalog_id", "title", "status", "published", "retired", "seg_count",
                               "duration_ms", "media_missing", "refs", "upload_received", "upload_total"}
    assert matches[0]["source_md5"] == MD5_A and matches[0]["title"] == "New ready"
    assert matches[0]["status"] == "ready" and matches[0]["published"] is True and matches[0]["retired"] is False
    assert matches[0]["seg_count"] == 2 and matches[0]["refs"] == 0 and matches[0]["media_missing"] is False
    assert matches[1]["status"] == "failed"
    assert all(m["source_md5"] == MD5_A for m in matches)  # MD5_B and MD5_C are not in the answer


async def test_check_reports_no_match_as_an_empty_list_and_a_retired_row_as_retired(app, client):
    h = await login_as(app, client, "operator")
    assert (await client.post(f"{BASE}/packages/check", headers=h,
                              json={"source_md5s": [MD5_C]})).json() == {"matches": []}
    cid = await make_catalog(app, published=False, retired=True)
    await _set(app, cid, source_md5=MD5_A)
    (match,) = (await client.post(f"{BASE}/packages/check", headers=h,
                                  json={"source_md5s": [MD5_A]})).json()["matches"]
    assert match["retired"] is True and match["published"] is False


async def test_check_counts_copies_as_refs(app, client, monkeypatch):
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app)
    await _set(app, cid, source_md5=MD5_A)
    _uid, uh = await register(client, "anna")
    assert (await client.post(f"/api/library/catalog/{cid}/add", headers=uh)).status_code == 200
    (match,) = (await client.post(f"{BASE}/packages/check", headers=h,
                                  json={"source_md5s": [MD5_A]})).json()["matches"]
    assert match["refs"] == 1


async def test_check_is_read_only_and_logs_only_counts(app, client, caplog):
    caplog.set_level(logging.INFO, logger="app")
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app, title=SECRET_TITLE)
    await _set(app, cid, source_md5=MD5_A)
    before = await _snapshot(app)
    r = await client.post(f"{BASE}/packages/check", headers=h, json={"source_md5s": [MD5_A, MD5_B]})
    assert r.status_code == 200
    assert await _snapshot(app) == before  # no row changed
    audits_before = len(await _audits(app))
    r = await client.post(f"{BASE}/packages/check", headers=h, json={"source_md5s": [MD5_B]})
    assert len(await _audits(app)) == audits_before  # the check is not audited (read-only)
    messages = [rec.getMessage() for rec in caplog.records if "package check" in rec.getMessage()]
    assert "library catalog package check n=2 matched=1" in messages
    assert not any(MD5_A in rec.getMessage() or SECRET_TITLE in rec.getMessage() for rec in caplog.records)


async def _snapshot(app) -> list[tuple]:
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(CatalogItem).order_by(CatalogItem.id))).all()
        return [(r.id, r.status, r.updated_at, r.source_md5, r.published, r.retired_at) for r in rows]


async def test_check_validates_the_body_and_the_roles(app, client):
    h = await login_as(app, client, "operator")
    url = f"{BASE}/packages/check"
    assert (await client.post(url, headers=h, json={"source_md5s": [MD5_A] * 1001})).status_code == 422
    assert (await client.post(url, headers=h, json={"source_md5s": []})).status_code == 422
    assert (await client.post(url, headers=h, json={"source_md5s": ["not-an-md5"]})).status_code == 422
    assert (await client.post(url, headers=h, json={"source_md5s": [MD5_A], "extra": 1})).status_code == 422
    assert (await client.post(url, headers=h, json={"source_md5s": [MD5_A] * 1000})).status_code == 200
    viewer = await login_as(app, client, "viewer")
    assert (await client.post(url, headers=viewer, json={"source_md5s": [MD5_A]})).status_code == 403
    assert (await client.post(url, json={"source_md5s": [MD5_A]})).status_code == 403  # admin: no session, no access


# ---- privacy: nothing in logs, audit or the user's payloads ----

async def test_the_md5_and_the_title_never_reach_logs_or_audit(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    h = await login_as(app, client, "operator")
    assert (await _start(client, h, source_md5=MD5_A)).status_code == 200
    assert (await _start(client, h, source_md5=MD5_A)).status_code == 409
    await client.post(f"{BASE}/packages/check", headers=h, json={"source_md5s": [MD5_A]})
    text = " ".join(f"{r.getMessage()} {r.args!r} {r.exc_text or ''}" for r in caplog.records)
    assert MD5_A not in text and SECRET_TITLE not in text
    dumped = " ".join(f"{a.summary} {a.before} {a.after} {a.reason} {a.target_id}" for a in await _audits(app))
    assert MD5_A not in dumped and SECRET_TITLE not in dumped


async def test_a_published_copy_of_a_package_item_carries_no_md5(app, client):
    h = await login_as(app, client, "operator")
    cid = await make_catalog(app)
    await _set(app, cid, source_md5=MD5_A)
    assert (await client.post(f"{BASE}/{cid}/publish", headers=h, json={})).status_code == 200
    _uid, uh = await register(client, "anna")
    r = await client.post(f"/api/library/catalog/{cid}/add", headers=uh)
    assert r.status_code == 200, r.text
    assert "source_md5" not in r.text and MD5_A not in r.text
    listing = (await client.get("/api/library/catalog", headers=uh)).text
    assert MD5_A not in listing
    await drain_background(app)
