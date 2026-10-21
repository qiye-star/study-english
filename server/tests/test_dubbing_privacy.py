"""L5 S11 隐私清单(plan L5 R21):新路由全部登记;URL 只有 uuid;完整走一遍配音流程后,日志与审计里没有句子、角色名、
模型回复或上游错误文字。新增配音路由时必须加进 `ROUTES`。"""
import logging
import uuid

import pytest
from sqlalchemy import select

from app.library import roles_ai
from app.models import AdminAudit
from app.providers import llm
from app.providers.xfyun_result import to_assessment
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.catalog_helpers import data_dir_of, make_catalog
from tests.dubbing_helpers import LLM_BASE, make_item, make_user, user_id_of, dubbing_settings
from tests.library_helpers import enable
from tests.test_xfyun_result import REFERENCE, load
from app.models import Assessment
from app.library.catalog_store import add_to_library
from datetime import datetime, timezone

ROUTES = {
    ("GET", "/api/dubbing/config"),
    ("GET", "/api/dubbing/items/{item_id}/roles"),
    ("PUT", "/api/dubbing/items/{item_id}/roles"),
    ("POST", "/api/dubbing/items/{item_id}/roles/suggest"),
    ("POST", "/api/dubbing/items/{item_id}/takes"),
    ("GET", "/api/dubbing/items/{item_id}/takes"),
    ("GET", "/api/dubbing/takes/{dub_id}"),
    ("DELETE", "/api/dubbing/takes/{dub_id}"),
    ("POST", "/api/dubbing/takes/{dub_id}/lines"),
    ("POST", "/api/dubbing/takes/{dub_id}/finish"),
    ("GET", "/api/admin/library/catalog/{catalog_id}/roles"),
    ("PUT", "/api/admin/library/catalog/{catalog_id}/roles"),
    ("POST", "/api/admin/library/catalog/{catalog_id}/roles/suggest"),
}
ALLOWED_PATH = {"item_id", "dub_id", "catalog_id"}
SECRETS = ("SECRET-ROLE", "SECRET-LINE", "SECRET-REPLY", "SECRET-UPSTREAM")
NOW = datetime(2026, 10, 21, 8, 0, tzinfo=timezone.utc)


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **dubbing_settings(tmp_path, library_ai_enabled=True, upstream_llm_base_url=LLM_BASE)}


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


def test_every_dubbing_and_admin_role_route_is_listed_and_carries_only_ids(app):
    seen = set()
    for path, operations in app.openapi()["paths"].items():
        if "dubbing" not in path and not path.endswith(("/roles", "/roles/suggest")):
            continue
        for method, op in operations.items():
            if method.upper() not in {"GET", "PUT", "POST", "DELETE"}:
                continue
            key = (method.upper(), path)
            assert key in ROUTES, f"new dubbing route needs a privacy test: {method} {path}"
            seen.add(key)
            params = op.get("parameters", [])
            assert {p["name"] for p in params if p["in"] == "path"} <= ALLOWED_PATH, path
            assert not [p for p in params if p["in"] == "query"], path
    assert ROUTES <= seen


async def test_a_full_pass_leaks_no_sentence_role_name_reply_or_upstream_text(app, client, auth_headers, monkeypatch,
                                                                             caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    uid = await user_id_of(app)
    lines = [(0, 900, "SECRET-LINE one."), (1000, 1900, "Second line."), (2000, 2900, "Third line.")]
    item = await make_item(app, uid, lines, speakers=["A", "B", "A"])
    headers = auth_headers

    async def complete(http, settings, messages, **kwargs):
        if kwargs.get("max_tokens") == roles_ai._tokens(3):
            return "1. A SECRET-REPLY\n2. B\n3. A"
        return "1. A"

    monkeypatch.setattr(roles_ai.llm, "complete", complete)
    r = await client.put(f"/api/dubbing/items/{item}/roles", headers=headers,
                         json={"names": {"A": "SECRET-ROLE"}, "speakers": [{"idx": 0, "speaker": "A"}]})
    assert r.status_code == 200, r.text
    r = await client.post(f"/api/dubbing/items/{item}/roles/suggest", headers=headers,
                          json={"seg_from": 0, "seg_to": 2})
    assert r.status_code == 200, r.text
    take = (await client.post(f"/api/dubbing/items/{item}/takes", headers=headers,
                              json={"seg_from": 0, "seg_to": 2, "role": "A"})).json()["take"]["id"]
    aid = str(uuid.uuid4())
    result = to_assessment(load("ise_good.xml"), REFERENCE)
    async with app.state.sessionmaker() as s:
        s.add(Assessment(id=aid, user_id=uid, reference_text="SECRET-LINE one.", language="en", duration_ms=5200,
                         audio_bytes=1, scores={}, result=result, audio_path="x/y.wav", source="library"))
        await s.commit()
    r = await client.post(f"/api/dubbing/takes/{take}/lines", headers=headers,
                          json={"seg_idx": 0, "assessment_id": aid, "rec_start_ms": 0, "voiced_ms": 800,
                                "capture": "pcm"})
    assert r.status_code == 200, r.text
    assert (await client.post(f"/api/dubbing/takes/{take}/finish", headers=headers)).status_code == 200
    # a failed suggestion path: only the upstream error kind is seen, never its text
    async def fail(http, settings, messages, **kwargs):
        raise llm.LlmUnavailable("http", 502)

    monkeypatch.setattr(roles_ai.llm, "complete", fail)
    r = await client.post(f"/api/dubbing/items/{item}/roles/suggest", headers=headers,
                          json={"seg_from": 0, "seg_to": 1})
    assert r.status_code == 503

    operator = await login_as(app, client, "operator")
    cid = await make_catalog(app)
    carol = await make_user(app, 6666666, "carol")
    async with app.state.sessionmaker() as s:
        await add_to_library(s, data_dir_of(app), user_id=carol, catalog_id=cid, now=NOW)
    r = await client.put(f"/api/admin/library/catalog/{cid}/roles", headers=operator,
                         json={"names": {"A": "SECRET-ROLE"}, "speakers": [{"idx": 0, "speaker": "A"}]})
    assert r.status_code == 200, r.text

    text = " ".join(f"{rec.getMessage()} {rec.args!r}" for rec in caplog.records)
    for secret in SECRETS:
        assert secret not in text, secret
    async with app.state.sessionmaker() as s:
        audits = list((await s.scalars(select(AdminAudit))).all())
    for row in audits:
        blob = f"{row.summary} {row.before} {row.after} {row.reason}"
        for secret in SECRETS:
            assert secret not in blob, secret
