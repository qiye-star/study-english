"""Admin bundle endpoints (plan L1 Task 22): export (operator), list (viewer), import (operator, reason required), the
route order that keeps `bundles` from being read as a catalog id, and an audit trail with ids and numbers only."""
import logging

import pytest
from sqlalchemy import delete, select

from app.models import AdminAudit, CatalogItem, CatalogSegment
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.catalog_helpers import make_catalog
from tests.library_helpers import library_settings

BASE = "/api/admin/library/catalog"
TITLE = "Marker title for the bundle audit test"


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True)}


async def _forget(app, cid):
    async with app.state.sessionmaker() as s:
        await s.execute(delete(CatalogSegment).where(CatalogSegment.catalog_id == cid))
        await s.execute(delete(CatalogItem).where(CatalogItem.id == cid))
        await s.commit()


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_export_list_and_import_round_trip_for_the_right_roles(app, client, storage_backend, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    cid = await make_catalog(app, title=TITLE)

    # one role per login: the admin session cookie lives in the client's jar, so the last login wins
    viewer = await login_as(app, client, "viewer")
    assert (await client.post(f"{BASE}/{cid}/bundle", headers=viewer)).status_code == 403
    operator = await login_as(app, client, "operator")
    exported = await client.post(f"{BASE}/{cid}/bundle", headers=operator)
    assert exported.status_code == 200 and exported.json()["segments"] == 2

    viewer = await login_as(app, client, "viewer", username="viewer2")
    listed = await client.get(f"{BASE}/bundles", headers=viewer)  # 200, not a UUID validation error
    assert listed.status_code == 200
    assert [(b["catalog_id"], b["importable"]) for b in listed.json()["bundles"]] == [(cid, False)]

    await _forget(app, cid)
    listed = (await client.get(f"{BASE}/bundles", headers=viewer)).json()["bundles"]
    assert [(b["catalog_id"], b["importable"]) for b in listed] == [(cid, True)]
    assert (await client.post(f"{BASE}/bundles/{cid}/import", headers=viewer,
                              json={"reason": "x"})).status_code == 403

    operator = await login_as(app, client, "operator", username="operator2")
    assert (await client.post(f"{BASE}/bundles/{cid}/import", headers=operator,
                              json={"reason": ""})).status_code == 422
    imported = await client.post(f"{BASE}/bundles/{cid}/import", headers=operator, json={"reason": "restore"})
    assert imported.status_code == 200 and imported.json()["published"] is False
    again = await client.post(f"{BASE}/bundles/{cid}/import", headers=operator, json={"reason": "again"})
    assert again.status_code == 409 and again.json() == {"error": "Item exists"}

    async with app.state.sessionmaker() as s:
        actions = (await s.scalars(select(AdminAudit.action).where(AdminAudit.action.like("catalog.bundle%")))).all()
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action.like("catalog.bundle%")))).all()
    assert sorted(actions) == ["catalog.bundle_export", "catalog.bundle_import"]  # one import; the refused one is silent
    audit_text = " ".join(f"{r.action} {r.target_id} {r.summary or ''} {r.after or ''}" for r in rows)
    assert TITLE not in audit_text and TITLE not in caplog.text
    assert "bundles/" not in audit_text and "library/" not in audit_text


async def test_the_import_and_its_audit_row_commit_in_one_transaction(app, client, monkeypatch):
    """plan L1 T22: if the audit row cannot be written, the import must not survive it (and vice versa)."""
    cid = await make_catalog(app, title=TITLE)
    operator = await login_as(app, client, "operator")
    assert (await client.post(f"{BASE}/{cid}/bundle", headers=operator)).status_code == 200
    await _forget(app, cid)

    from app.admin import audit, catalog_admin

    real_record = audit.record

    async def broken_after_recording(session, *args, **kwargs):
        await real_record(session, *args, **kwargs)  # the row is written in the open transaction ...
        raise RuntimeError("audit write failed")  # ... and then the write fails before the commit

    monkeypatch.setattr(catalog_admin.audit, "record", broken_after_recording)
    with pytest.raises(RuntimeError):
        await client.post(f"{BASE}/bundles/{cid}/import", headers=operator, json={"reason": "restore"})

    async with app.state.sessionmaker() as s:
        assert await s.get(CatalogItem, cid) is None  # the import was rolled back with the audit row
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "catalog.bundle_import"))).all()
    assert rows == []

    monkeypatch.setattr(catalog_admin.audit, "record", real_record)
    ok = await client.post(f"{BASE}/bundles/{cid}/import", headers=operator, json={"reason": "restore"})
    assert ok.status_code == 200
    async with app.state.sessionmaker() as s:
        assert await s.get(CatalogItem, cid) is not None
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "catalog.bundle_import"))).all()
    assert len(rows) == 1
