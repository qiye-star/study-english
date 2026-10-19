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
