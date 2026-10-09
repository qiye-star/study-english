import json

import httpx
import pytest
import respx
from sqlalchemy import select

from app.admin import probes as probes_mod
from app.admin.probes import ProbeResult, is_private_host, probe
from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.conftest import make_settings


async def public(host):
    return False


@respx.mock
async def test_llm_probe_ok_auth_and_never_returns_body():
    respx.get("https://llm.test/v1/models").mock(return_value=httpx.Response(200, json={"data": [{"id": "secret-model"}]}))
    async with httpx.AsyncClient() as http:
        r = await probe(http, make_settings(), "llm", resolver=public)
    assert r == ProbeResult(True, 200, r.ms, "ok")
    respx.get("https://llm.test/v1/models").mock(return_value=httpx.Response(401, json={"error": "bad key llm-secret"}))
    async with httpx.AsyncClient() as http:
        r = await probe(http, make_settings(), "llm", resolver=public)
    assert (r.ok, r.code) == (False, "auth") and "llm-secret" not in repr(r)


@respx.mock
async def test_models_404_needs_cost_permission():
    respx.get("https://llm.test/v1/models").mock(return_value=httpx.Response(404))
    route = respx.post("https://llm.test/v1/chat/completions").mock(return_value=httpx.Response(200, json={"choices": []}))
    async with httpx.AsyncClient() as http:
        assert (await probe(http, make_settings(), "llm", resolver=public)).code == "cost_not_allowed"
        assert (await probe(http, make_settings(), "llm", allow_cost=True, resolver=public)).code == "ok"
    assert json.loads(route.calls.last.request.content)["max_tokens"] == 1


async def test_private_hosts_and_missing_config():
    async def private(host):
        return True

    async with httpx.AsyncClient() as http:
        assert (await probe(http, make_settings(), "llm", resolver=private)).code == "blocked_private"
        assert (await probe(http, make_settings(xfyun_app_id=""), "xfyun", resolver=public)).code == "not_configured"
    for host in ("127.0.0.1", "10.0.0.8", "169.254.169.254", "::1", "localhost"):
        assert await is_private_host(host) is True
    assert await is_private_host("8.8.8.8") is False


@respx.mock
async def test_timeouts_and_no_redirects():
    respx.get("https://llm.test/v1/models").mock(side_effect=httpx.ConnectTimeout("t"))
    async with httpx.AsyncClient() as http:
        assert (await probe(http, make_settings(), "llm", resolver=public)).code == "timeout"
    respx.get("https://llm.test/v1/models").mock(return_value=httpx.Response(302, headers={"location": "http://169.254.169.254/"}))
    async with httpx.AsyncClient() as http:
        assert (await probe(http, make_settings(), "llm", resolver=public)).code == "bad_response"


@pytest.fixture
def settings_overrides(request):
    return {**ADMIN_ENABLED, **getattr(request, "param", {})}


async def test_probe_endpoint_roles_pair_guard_and_audit(app, client, monkeypatch):
    seen = {}

    async def fake_probe(http, s, upstream, *, allow_cost=False, **kw):
        seen.update(url=s.upstream_llm_base_url, key=s.upstream_llm_key, allow_cost=allow_cost)
        return ProbeResult(True, 200, 12, "ok")

    monkeypatch.setattr(probes_mod, "probe", fake_probe)
    op = await login_as(app, client, "operator")
    assert (await client.post("/api/admin/probes/llm", headers=op, json={})).status_code == 403
    client.cookies.clear()
    h = await login_as(app, client, "superadmin")
    assert (await client.post("/api/admin/probes/nope", headers=h, json={})).status_code == 404
    r = await client.post("/api/admin/probes/llm", headers=h, json={"values": {"upstream_llm_base_url": "https://x.example/v1"}})
    assert r.status_code == 409 and r.json()["details"]["hosts"] == {"upstream_llm_base_url": "x.example"}
    r = await client.post("/api/admin/probes/llm", headers=h, json={
        "values": {"upstream_llm_base_url": "https://x.example/v1", "upstream_llm_key": ""},
        "confirm_pairs": ["upstream_llm_base_url"], "allow_cost": True})
    assert r.json() == {"ok": True, "status": 200, "ms": 12, "code": "ok"}
    assert seen == {"url": "https://x.example/v1", "key": "llm-secret", "allow_cost": True}
    r = await client.post("/api/admin/probes/llm", headers=h, json={"values": {"database_url": "x"}})
    assert r.status_code == 400
    r = await client.post("/api/admin/probes/llm", headers=h, json={"values": {"upstream_llm_base_url": "ftp://x"}})
    assert r.status_code == 422
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "probe.run"))).all()
    assert [(a.target_id, a.summary) for a in rows] == [("llm", "ok")]
    assert "llm-secret" not in json.dumps([a.after for a in rows])
