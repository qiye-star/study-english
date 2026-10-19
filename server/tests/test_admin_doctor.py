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


def _email_findings(**kw):
    base = dict(registration_mode="closed", email_registration_required=False)
    return {f.code: f for f in diagnose(make_settings(**{**base, **kw}), OK)
            if f.code in ("email_not_configured", "email_console_backend", "binding_without_deadline")}


def _email_keys():
    from cryptography.fernet import Fernet
    from tests.accounts_helpers import PEPPER
    return dict(identity_pepper=PEPPER, settings_encryption_key=Fernet.generate_key().decode())


def test_email_backend_without_keys_is_an_error():
    found = _email_findings(email_backend="smtp")
    assert found["email_not_configured"].level == "error" and "email_backend" in found["email_not_configured"].keys
    assert "email_not_configured" not in _email_findings()  # backend off: nothing to configure


def test_ready_email_backend_is_fine_and_console_warns():
    keys = _email_keys()
    assert _email_findings(email_backend="smtp", **keys) == {}
    found = _email_findings(email_backend="console", **keys)
    assert list(found) == ["email_console_backend"] and found["email_console_backend"].level == "warn"


def test_forced_binding_needs_a_ready_email_and_a_deadline():
    found = _email_findings(email_binding_required=True, email_binding_deadline="2026-12-01T00:00+08:00")
    assert found["email_not_configured"].level == "error"
    assert "email_binding_required" in found["email_not_configured"].keys
    found = _email_findings(email_binding_required=True, **_email_keys(), email_backend="smtp")
    assert list(found) == ["binding_without_deadline"]
    assert found["binding_without_deadline"].level == "warn"
    assert found["binding_without_deadline"].keys == ("email_binding_deadline",)
    assert "binding_without_deadline" not in _email_findings()  # not forced: no warning


def test_registration_that_needs_email_is_an_error_until_email_is_ready():
    """The shipped default (EMAIL_REGISTRATION_REQUIRED=true, EMAIL_BACKEND=off) answers every registration 503."""
    found = _email_findings(email_registration_required=True)
    assert found["email_not_configured"].level == "error"
    assert "email_registration_required" in found["email_not_configured"].keys
    assert "email_not_configured" not in _email_findings(email_registration_required=True, email_backend="smtp",
                                                         **_email_keys())
    assert "email_not_configured" not in _email_findings(email_registration_required=False)


def test_email_diagnostic_codes_are_registered_and_messages_hold_no_values():
    for code in ("email_not_configured", "email_console_backend", "binding_without_deadline"):
        assert code in CODES
    found = _email_findings(email_backend="smtp", smtp_host="smtp.secret-host.test", smtp_password="pw-secret",
                            email_binding_required=True)
    assert "secret-host" not in repr(found) and "pw-secret" not in repr(found)


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
