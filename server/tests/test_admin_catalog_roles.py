"""L5 S10:管理端精选库的角色标注(plan L5 S10 / R4、R7、R21)。viewer 只读,operator 可写;审计只记 id 与数字。"""
import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.library import catalog_store, roles_ai
from app.library.catalog_store import add_to_library
from app.models import AdminAudit, LibraryItem
from app.providers import llm
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.catalog_helpers import data_dir_of, make_catalog
from tests.dubbing_helpers import LLM_BASE, make_user
from tests.library_helpers import enable, library_settings

BASE = "/api/admin/library/catalog"
NOW = datetime(2026, 10, 21, 8, 0, tzinfo=timezone.utc)


@pytest.fixture
def settings_overrides(request, tmp_path):
    extra = getattr(request, "param", {})
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_ai_enabled=True, upstream_llm_base_url=LLM_BASE,
                                                **extra)}


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def _audits(app) -> list[AdminAudit]:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AdminAudit))).all())


def fake_llm(monkeypatch, reply: str | None = None, exc: Exception | None = None):
    async def complete(http, settings, messages, **kwargs):
        if exc is not None:
            raise exc
        return reply

    monkeypatch.setattr(roles_ai.llm, "complete", complete)


async def test_viewer_reads_and_only_an_operator_writes(app, client):
    cid = await make_catalog(app)
    viewer = await login_as(app, client, "viewer")
    r = await client.get(f"{BASE}/{cid}/roles", headers=viewer)
    assert r.status_code == 200 and r.json()["editable"] is True
    r = await client.put(f"{BASE}/{cid}/roles", headers=viewer, json={"names": {"A": "Host"}})
    assert r.status_code == 403


async def test_a_save_syncs_the_copies_and_audits_only_numbers(app, client):
    cid = await make_catalog(app)
    uid = await make_user(app, 5555555, "carol")
    async with app.state.sessionmaker() as s:
        item, _ = await add_to_library(s, data_dir_of(app), user_id=uid, catalog_id=cid, now=NOW)
    operator = await login_as(app, client, "operator")
    r = await client.put(f"{BASE}/{cid}/roles", headers=operator,
                         json={"names": {"A": "Host", "B": "Guest"},
                               "speakers": [{"idx": 0, "speaker": "A"}, {"idx": 1, "speaker": "B"}]})
    assert r.status_code == 200, r.text
    assert r.json()["copies"] == 1 and [n["name"] for n in r.json()["names"]] == ["Host", "Guest"]
    async with app.state.sessionmaker() as s:
        copy = await s.get(LibraryItem, item.id)
        assert copy.role_names == {"A": "Host", "B": "Guest"}
    edit = [a for a in await _audits(app) if a.action == "catalog.roles.edit"]
    assert len(edit) == 1 and edit[0].after == {"lines": 2, "roles": 2, "copies": 1}
    row = edit[0]
    leaked = json.dumps([row.summary, row.before, row.after])
    assert "Host" not in leaked and "Guest" not in leaked and "Line" not in leaked


async def test_bad_roles_and_unready_items_are_refused(app, client):
    cid = await make_catalog(app)
    queued = await make_catalog(app, status="queued", published=False)
    operator = await login_as(app, client, "operator")
    r = await client.put(f"{BASE}/{cid}/roles", headers=operator, json={"names": {"G": "x"}})
    assert r.status_code == 400 and r.json()["error"] == "Invalid roles"
    r = await client.put(f"{BASE}/{queued}/roles", headers=operator, json={"names": {"A": "x"}})
    assert r.status_code == 409 and r.json()["error"] == "Item is not ready"


async def test_unknown_catalog_item_is_404(app, client):
    viewer = await login_as(app, client, "viewer")
    r = await client.get(f"{BASE}/11111111-2222-4333-8444-555555555555/roles", headers=viewer)
    assert r.status_code == 404


async def test_suggest_returns_letters_without_saving_and_audits_the_count(app, client, monkeypatch):
    cid = await make_catalog(app)
    fake_llm(monkeypatch, "1. A\n2. B")
    operator = await login_as(app, client, "operator")
    r = await client.post(f"{BASE}/{cid}/roles/suggest", headers=operator, json={"seg_from": 0, "seg_to": 1})
    assert r.status_code == 200, r.text
    assert r.json() == {"speakers": [{"idx": 0, "speaker": "A"}, {"idx": 1, "speaker": "B"}]}
    async with app.state.sessionmaker() as s:
        segs = await catalog_store.segments_of(s, cid)
        assert [seg.speaker for seg in segs] == [None, None]
    suggest = [a for a in await _audits(app) if a.action == "catalog.roles.suggest"]
    assert len(suggest) == 1 and suggest[0].after == {"lines": 2}


async def test_suggest_is_capped_at_forty_sentences(app, client, monkeypatch):
    cid = await make_catalog(app, segments=[(i * 1000, i * 1000 + 900, f"Line {i}.", "行") for i in range(41)])
    fake_llm(monkeypatch, "1. A")
    operator = await login_as(app, client, "operator")
    r = await client.post(f"{BASE}/{cid}/roles/suggest", headers=operator, json={"seg_from": 0, "seg_to": 40})
    assert r.status_code == 400 and r.json()["error"] == "Too many sentences"


@pytest.mark.parametrize("settings_overrides", [{"library_catalog_ai_daily": 0}], indirect=True)
async def test_suggest_with_the_catalog_budget_spent_is_429(app, client, monkeypatch):
    cid = await make_catalog(app)
    fake_llm(monkeypatch, "1. A")
    operator = await login_as(app, client, "operator")
    r = await client.post(f"{BASE}/{cid}/roles/suggest", headers=operator, json={"seg_from": 0, "seg_to": 0})
    assert r.status_code == 429 and r.json()["error"] == "AI is busy today"


async def test_an_upstream_failure_is_503(app, client, monkeypatch):
    cid = await make_catalog(app)
    fake_llm(monkeypatch, exc=llm.LlmUnavailable("http", 502))
    operator = await login_as(app, client, "operator")
    r = await client.post(f"{BASE}/{cid}/roles/suggest", headers=operator, json={"seg_from": 0, "seg_to": 0})
    assert r.status_code == 503 and r.json()["error"] == "AI is unavailable"
