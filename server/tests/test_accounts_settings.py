"""账号 v2 的设置项(计划 S2 / S11;INDEX X9、X12)。"""
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.settings_registry import ENV_ONLY, GROUPS, SECRETS, SPECS

PEPPER = "p" * 32


def test_access_token_ttl_defaults_to_30_and_is_bounded():
    assert Settings(_env_file=None).access_token_ttl_days == 30
    spec = SPECS["access_token_ttl_days"]
    assert spec.kind == "int"
    assert spec.apply == "hot"
    assert (spec.min, spec.max) == (1, 365)
    assert spec.group == "accounts"
    with pytest.raises(ValidationError):
        Settings(_env_file=None, access_token_ttl_days=0)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, access_token_ttl_days=366)


def test_identity_pepper_is_env_only_secret():
    spec = SPECS["identity_pepper"]
    assert spec.env_only and spec.secret
    assert "identity_pepper" in ENV_ONLY and "identity_pepper" in SECRETS
    assert Settings(_env_file=None, identity_pepper="").identity_pepper == ""
    assert Settings(_env_file=None, identity_pepper=PEPPER).identity_pepper == PEPPER
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None, identity_pepper="short")
    assert "short" not in str(exc.value)  # a validation error never echoes the value


def test_accounts_group_follows_registration():
    keys = [key for key, _ in GROUPS]
    assert ("accounts", "账号与邮箱") in GROUPS
    assert keys[keys.index("registration") + 1] == "accounts"


# --- S11: email, SMTP and binding settings ---------------------------------------------------------------------

EMAIL_KEYS = {
    "email_registration_required", "email_backend", "smtp_host", "smtp_port", "smtp_security", "smtp_user",
    "smtp_password", "smtp_from", "email_codes_per_target_daily", "email_codes_per_ip_hourly", "email_daily_global",
    "email_domain_mode", "email_domain_list", "email_binding_required", "email_binding_deadline",
}


def test_every_email_setting_has_a_spec_in_the_accounts_group_and_is_hot():
    assert EMAIL_KEYS <= set(Settings.model_fields)
    for key in EMAIL_KEYS:
        spec = SPECS[key]
        assert spec.group == "accounts", key
        assert spec.apply == "hot" and not spec.env_only, key
    assert SPECS["email_backend"].kind == "enum" and SPECS["email_domain_mode"].kind == "enum"
    assert SPECS["smtp_security"].kind == "enum"
    assert SPECS["email_domain_list"].kind == "csv"
    assert SPECS["email_registration_required"].kind == "bool"
    assert SPECS["smtp_host"].pair == "smtp_password" and SPECS["smtp_host"].danger


def test_smtp_password_is_a_secret_and_never_shown_in_errors():
    assert SPECS["smtp_password"].secret and SPECS["smtp_password"].kind == "secret"
    assert "smtp_password" in SECRETS
    assert "smtp_password" not in ENV_ONLY  # hot: editable (write-only) in the admin console


def test_email_defaults_and_bounds():
    s = Settings(_env_file=None)
    assert (s.email_registration_required, s.email_backend, s.smtp_host, s.smtp_port, s.smtp_security) == (
        True, "off", "", 465, "ssl")
    assert (s.smtp_user, s.smtp_password, s.smtp_from) == ("", "", "")
    assert (s.email_codes_per_target_daily, s.email_codes_per_ip_hourly, s.email_daily_global) == (10, 10, 200)
    assert (s.email_domain_mode, s.email_domain_list) == ("blocklist", "")
    assert (s.email_binding_required, s.email_binding_deadline) == (False, "")
    for kwargs in ({"smtp_port": 0}, {"smtp_port": 65536}, {"email_codes_per_target_daily": 0},
                   {"email_codes_per_target_daily": 101}, {"email_codes_per_ip_hourly": 0},
                   {"email_codes_per_ip_hourly": 1001}, {"email_daily_global": 0}, {"email_daily_global": 100001},
                   {"email_backend": "sendmail"}, {"smtp_security": "none"}, {"email_domain_mode": "deny"}):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, **kwargs)


def test_binding_deadline_needs_a_timezone():
    assert Settings(_env_file=None).email_binding_deadline_at is None
    ok = Settings(_env_file=None, email_binding_deadline="2026-10-28T00:00+08:00")
    got = ok.email_binding_deadline_at
    assert got is not None and got.tzinfo is not None
    assert got.utcoffset().total_seconds() == 8 * 3600
    assert Settings(_env_file=None, email_binding_deadline="2026-10-28T00:00:00Z").email_binding_deadline_at is not None
    for bad in ("2026-10-28", "2026-10-28T00:00", "soon", "2026-13-40T00:00+08:00"):
        with pytest.raises(ValidationError) as exc:
            Settings(_env_file=None, email_binding_deadline=bad)
        assert bad not in str(exc.value)


def test_smtp_password_is_not_echoed_by_a_validation_error():
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None, smtp_password="authcode-secret", smtp_port=0)
    assert "authcode-secret" not in str(exc.value)


def test_make_settings_keeps_the_old_registration_flow_by_default():
    from tests.conftest import make_settings

    assert make_settings().email_registration_required is False
    assert make_settings(email_registration_required=True).email_registration_required is True


def test_env_example_documents_every_email_setting_with_a_chinese_comment():
    from pathlib import Path

    lines = (Path(__file__).resolve().parent.parent / ".env.example").read_text(encoding="utf-8").splitlines()
    for key in sorted(EMAIL_KEYS):
        name = f"{key.upper()}="
        idx = next(i for i, line in enumerate(lines) if line.startswith(name))
        comment = lines[idx - 1]
        assert comment.startswith("#") and any("一" <= ch <= "鿿" for ch in comment), key
    smtp = next(line for line in lines if line.startswith("SMTP_PASSWORD="))
    assert smtp == "SMTP_PASSWORD="  # a placeholder, never a value
