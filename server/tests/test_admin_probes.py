import json

import httpcore
import httpx
import pytest
import respx
from sqlalchemy import select

from app.admin import probes as probes_mod
from app.admin.probes import ProbeResult, is_private_host, probe
from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.conftest import make_settings


async def public(host):
    return ["93.184.216.34"]


@respx.mock
async def test_llm_probe_ok_auth_and_never_returns_body():
    respx.get("https://llm.test/v1/models").mock(return_value=httpx.Response(200, json={"data": [{"id": "secret-model"}]}))
    r = await probe(make_settings(), "llm", resolver=public)
    assert r == ProbeResult(True, 200, r.ms, "ok")
    respx.get("https://llm.test/v1/models").mock(return_value=httpx.Response(401, json={"error": "bad key llm-secret"}))
    r = await probe(make_settings(), "llm", resolver=public)
    assert (r.ok, r.code) == (False, "auth") and "llm-secret" not in repr(r)


@respx.mock
async def test_models_404_needs_cost_permission():
    respx.get("https://llm.test/v1/models").mock(return_value=httpx.Response(404))
    route = respx.post("https://llm.test/v1/chat/completions").mock(return_value=httpx.Response(200, json={"choices": []}))
    assert (await probe(make_settings(), "llm", resolver=public)).code == "cost_not_allowed"
    assert (await probe(make_settings(), "llm", allow_cost=True, resolver=public)).code == "ok"
    assert json.loads(route.calls.last.request.content)["max_tokens"] == 1


async def test_private_hosts_and_missing_config():
    async def private(host):
        return ["93.184.216.34", "10.0.0.8"]  # any non-public address blocks the probe

    assert (await probe(make_settings(), "llm", resolver=private)).code == "blocked_private"
    assert (await probe(make_settings(xfyun_app_id=""), "xfyun", resolver=public)).code == "not_configured"
    for host in ("127.0.0.1", "10.0.0.8", "169.254.169.254", "::1", "localhost"):
        assert await is_private_host(host) is True
    assert await is_private_host("8.8.8.8") is False


@respx.mock
async def test_timeouts_and_no_redirects():
    respx.get("https://llm.test/v1/models").mock(side_effect=httpx.ConnectTimeout("t"))
    assert (await probe(make_settings(), "llm", resolver=public)).code == "timeout"
    respx.get("https://llm.test/v1/models").mock(return_value=httpx.Response(302, headers={"location": "http://169.254.169.254/"}))
    assert (await probe(make_settings(), "llm", resolver=public)).code == "bad_response"


@pytest.fixture
def settings_overrides(request):
    return {**ADMIN_ENABLED, **getattr(request, "param", {})}


async def test_probe_endpoint_roles_pair_guard_and_audit(app, client, monkeypatch):
    seen = {}

    async def fake_probe(s, upstream, *, allow_cost=False, **kw):
        seen.update(url=s.upstream_llm_base_url, key=s.upstream_llm_key, allow_cost=allow_cost)
        return ProbeResult(True, 200, 12, "ok")

    monkeypatch.setattr(probes_mod, "probe", fake_probe)
    op = await login_as(app, client, "operator")
    assert (await client.post("/api/admin/probes/llm", headers=op, json={})).status_code == 403
    client.cookies.clear()
    h = await login_as(app, client, "superadmin")
    assert (await client.post("/api/admin/probes/nope", headers=h, json={})).status_code == 404
    probe_body = {"values": {"upstream_llm_base_url": "https://x.example/v1", "upstream_llm_key": ""},
                  "confirm_pairs": ["upstream_llm_base_url"], "allow_cost": True}
    r = await client.post("/api/admin/probes/llm", headers=h, json=probe_body)
    assert r.status_code == 403 and seen == {}  # the saved key to a new host: step-up first (review M2)
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})).status_code == 200
    r = await client.post("/api/admin/probes/llm", headers=h, json={"values": {"upstream_llm_base_url": "https://x.example/v1"}})
    assert r.status_code == 409 and r.json()["details"]["hosts"] == {"upstream_llm_base_url": "x.example"}
    r = await client.post("/api/admin/probes/llm", headers=h, json=probe_body)
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


# ---- review m4: non-global ranges, DNS pinning, no WebSocket redirects --------------------------------------------

async def test_non_global_ranges_are_blocked():
    for host in ("100.64.0.1", "198.18.0.1", "192.0.0.8", "fc00::1", "::ffff:127.0.0.1", "0.0.0.0"):
        assert await is_private_host(host) is True, host
    assert await is_private_host("1.1.1.1") is False


async def test_probe_resolves_once_and_connects_to_the_checked_address(monkeypatch):
    """DNS rebinding: a second lookup could return 127.0.0.1; the connection must use the address checked."""
    lookups, connected = [], []

    async def resolver(host):
        lookups.append(host)
        return ["93.184.216.34"]

    class FakeInner(httpcore.AsyncNetworkBackend):
        async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
            connected.append((host, port))
            raise httpcore.ConnectError("stop here")

        async def sleep(self, seconds):
            return None

    real = probes_mod.PinnedBackend.__init__
    monkeypatch.setattr(probes_mod.PinnedBackend, "__init__",
                        lambda self, host, address, inner=None: real(self, host, address, FakeInner()))
    r = await probe(make_settings(), "llm", resolver=resolver)
    assert r.code == "network" and lookups == ["llm.test"] and connected == [("93.184.216.34", 443)]


async def test_pinned_backend_refuses_other_hosts():
    backend = probes_mod.PinnedBackend("api.example", "93.184.216.34")
    with pytest.raises(httpcore.ConnectError):
        await backend.connect_tcp("169.254.169.254", 80)


def test_websocket_redirects_are_never_followed():
    from websockets.exceptions import InvalidStatus
    from websockets.http11 import Response
    from websockets.datastructures import Headers

    exc = InvalidStatus(Response(302, "Found", Headers({"Location": "ws://169.254.169.254/latest"})))
    conn = probes_mod._connect_no_redirect("wss://ise-api.xfyun.cn/v2/open-ise")
    assert conn.process_redirect(exc) is exc


# ---- plan A2: SMTP probe (connect + TLS + login only, never sends mail) -------------------------------------------

SMTP_PASSWORD = "authcode-SECRET-123"


def smtp_settings(**kw):
    base = dict(email_backend="smtp", smtp_host="smtp.mailhost.test", smtp_port=465, smtp_security="ssl",
                smtp_user="noreply@mailhost.test", smtp_password=SMTP_PASSWORD)
    return make_settings(**{**base, **kw})


@pytest.fixture
def fake_smtp(monkeypatch):
    import smtplib

    from tests.test_email_provider import FakeSmtp

    FakeSmtp.instances, FakeSmtp.plan = [], {}
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSmtp)
    monkeypatch.setattr(smtplib, "SMTP", FakeSmtp)
    return FakeSmtp


def test_smtp_is_a_probe_upstream():
    assert "smtp" in probes_mod.UPSTREAMS


async def test_smtp_probe_not_configured_without_a_host(fake_smtp):
    r = await probe(smtp_settings(smtp_host=""), "smtp", resolver=public)
    assert (r.ok, r.code) == (False, "not_configured") and fake_smtp.instances == []


async def test_smtp_probe_blocks_private_hosts_before_connecting(fake_smtp):
    async def private(host):
        return ["10.0.0.8"]

    r = await probe(smtp_settings(), "smtp", resolver=private)
    assert (r.ok, r.code) == (False, "blocked_private") and fake_smtp.instances == []
    assert (await probe(smtp_settings(smtp_host="127.0.0.1"), "smtp")).code == "blocked_private"
    assert fake_smtp.instances == []


async def test_smtp_probe_ok_logs_in_but_never_sends(fake_smtp):
    r = await probe(smtp_settings(), "smtp", resolver=public)
    assert (r.ok, r.code) == (True, "ok")
    conn = fake_smtp.instances[0]
    assert [c[0] for c in conn.calls] == ["login"] and conn.sent == []
    assert not any(c[0] == "send_message" for c in conn.calls)


async def test_smtp_probe_starttls_mode_secures_before_login(fake_smtp):
    r = await probe(smtp_settings(smtp_security="starttls", smtp_port=587), "smtp", resolver=public)
    assert r.ok and [c[0] for c in fake_smtp.instances[0].calls] == ["ehlo", "starttls", "ehlo", "login"]


async def test_smtp_probe_failure_codes(fake_smtp):
    import smtplib
    import socket
    import ssl

    cases = [
        ({"login": smtplib.SMTPAuthenticationError(535, b"bad credentials for noreply@mailhost.test")}, "auth", 535),
        ({"connect": socket.timeout("timed out")}, "timeout", 0),
        ({"connect": ssl.SSLError("CERTIFICATE_VERIFY_FAILED smtp.mailhost.test")}, "tls", 0),
        ({"connect": ConnectionRefusedError("smtp.mailhost.test refused")}, "network", 0),
    ]
    for plan, code, status in cases:
        fake_smtp.plan = plan
        r = await probe(smtp_settings(), "smtp", resolver=public)
        assert (r.ok, r.code, r.status) == (False, code, status)
        assert set(r.out()) == {"ok", "status", "ms", "code"}
        blob = repr(r)
        assert "mailhost" not in blob and SMTP_PASSWORD not in blob and "credentials" not in blob


async def test_smtp_probe_has_an_eight_second_budget(monkeypatch):
    async def hang(settings):
        await asyncio.sleep(60)

    import asyncio

    monkeypatch.setattr(probes_mod.email_provider, "check", hang)
    monkeypatch.setattr(probes_mod, "SMTP_TIMEOUT", 0.05)
    r = await probe(smtp_settings(), "smtp", resolver=public)
    assert (r.ok, r.code) == (False, "timeout")


async def test_smtp_probe_endpoint_audit_and_logs_hold_no_host_or_password(app, client, fake_smtp, monkeypatch, caplog):
    import logging

    async def resolve(host, resolver=None):
        return "93.184.216.34"

    monkeypatch.setattr(probes_mod, "resolve_public", resolve)
    app.state.settings = app.state.settings.model_copy(update=dict(
        email_backend="smtp", smtp_host="smtp.mailhost.test", smtp_user="noreply@mailhost.test",
        smtp_password=SMTP_PASSWORD))
    h = await login_as(app, client, "superadmin")
    caplog.set_level(logging.DEBUG, logger="app")
    fake_smtp.plan = {"login": __import__("smtplib").SMTPAuthenticationError(535, b"nope")}
    r = await client.post("/api/admin/probes/smtp", headers=h, json={})
    assert r.status_code == 200 and r.json()["code"] == "auth" and set(r.json()) == {"ok", "status", "ms", "code"}
    fake_smtp.plan = {}
    r = await client.post("/api/admin/probes/smtp", headers=h, json={})
    assert r.json()["ok"] is True
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "probe.run"))).all()
    assert [(a.target_id, a.summary) for a in rows] == [("smtp", "auth"), ("smtp", "ok")]
    blob = json.dumps([[a.summary, a.after, a.before, a.target_id] for a in rows], default=str) + caplog.text + r.text
    assert "mailhost" not in blob and SMTP_PASSWORD not in blob
    assert all(not any(c[0] == "send_message" for c in i.calls) for i in fake_smtp.instances)
