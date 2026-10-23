"""L5 配音的开关、设置、错误串与包骨架(plan L5 S2 / R8、R22、R25)。"""
import re

from app.core.config import Settings
from app.core.settings_registry import SPECS
from app.dubbing import errors
from app.library import limits


def test_dubbing_defaults_are_off_and_the_suggest_quota_is_120():
    settings = Settings()
    assert settings.dubbing_enabled is False
    assert settings.dubbing_suggest_daily_per_user == 120


def test_both_settings_have_a_spec_each():
    assert SPECS["dubbing_enabled"].group == "features"
    assert SPECS["dubbing_enabled"].danger
    assert SPECS["dubbing_suggest_daily_per_user"].kind == "int"


def test_error_table_is_fixed_english_and_unique():
    assert errors.API_ERRORS, "the error table must not be empty"
    texts = []
    for code, (status, text) in errors.API_ERRORS.items():
        assert isinstance(status, int) and isinstance(text, str), code
        assert re.fullmatch(r"[A-Za-z][A-Za-z ,.'-]*", text), code  # fixed English, no f-strings or user data
        texts.append(text)
    assert len(set(texts)) == len(texts)
    assert errors.API_ERRORS["disabled"] == (404, "Dubbing is disabled")
    assert errors.API_ERRORS["roles_locked"] == (409, "Roles are set by the editors")
    assert errors.API_ERRORS["role_missing"] == (400, "Role has no lines in the clip")


def test_api_error_builds_the_fixed_http_error():
    exc = errors.api_error("disabled")
    assert exc.status_code == 404 and exc.detail == "Dubbing is disabled"


def test_dubbing_suggest_scope_name_fits_daily_usage():
    assert limits.SCOPE_DUBBING_SUGGEST == "dubbing_suggest"
    assert len(limits.SCOPE_DUBBING_SUGGEST) <= 32  # daily_usage.scope is String(32)
