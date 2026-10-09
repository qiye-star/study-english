from dataclasses import replace

import pytest

from app.admin.doctor import CODES, Facts, diagnose
from tests.admin_helpers import ADMIN_ENABLED, assert_no_secrets, login_as
from tests.conftest import make_settings

OK = Facts(encryption=True, superadmins_without_totp=0, invalid={}, drift=(), pending_restart=(), login_alarm=False,
           db_backend="postgresql", backups=1, missing_prices=(), safe_mode=False)


def codes(findings):
    return [f.code for f in findings]


def test_healthy_config_has_no_errors():
    assert [f for f in diagnose(make_settings(registration_mode="closed"), OK) if f.level == "error"] == []


def test_realtime_enabled_but_unavailable_lists_reasons():
    found = diagnose(make_settings(realtime_enabled=True), OK)
    rt = next(f for f in found if f.code == "realtime_unavailable")
    assert rt.level == "error" and "volcengine_tts_key" in rt.keys


def test_security_and_ops_warnings():
    facts = replace(OK, encryption=False, superadmins_without_totp=2, invalid={"x": "invalid"},
                    pending_restart=("rooms_ai_concurrency",), db_backend="sqlite", backups=0,
                    login_alarm=True, safe_mode=True)
    found = codes(diagnose(make_settings(registration_mode="open", admin_cookie_secure=False), facts))
    for code in ("registration_open", "no_encryption_key", "superadmin_without_totp", "invalid_overrides",
                 "pending_restart", "sqlite_without_backup", "insecure_cookie", "login_alarm", "safe_mode"):
        assert code in found
    assert set(found) <= set(CODES)


def test_findings_sorted_by_severity():
    found = diagnose(make_settings(realtime_enabled=True, registration_mode="open"), OK)
    order = {"error": 0, "warn": 1, "info": 2}
    assert [order[f.level] for f in found] == sorted(order[f.level] for f in found)


@pytest.fixture
def settings_overrides(request):
    return {**ADMIN_ENABLED, "registration_mode": "open", **getattr(request, "param", {})}


async def test_doctor_endpoint_gathers_facts(app, client):
    await login_as(app, client, "viewer")
    r = await client.get("/api/admin/doctor")
    assert r.status_code == 200
    found = {f["code"]: f for f in r.json()["findings"]}
    assert {"registration_open", "no_encryption_key", "superadmin_without_totp", "insecure_cookie"} <= set(found)
    assert set(found) <= set(CODES)
    assert_no_secrets(r.json(), app.state.settings)
