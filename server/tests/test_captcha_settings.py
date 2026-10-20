"""人机验证的设置项(计划 S1;spec 2026-10-20-captcha-altcha §4)。"""
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.settings_registry import SECRETS, SPECS, choices_for, field_bounds

CAPTCHA_KEYS = (
    "captcha_mode", "captcha_secret", "captcha_ttl_seconds", "captcha_cost", "captcha_counter_max",
    "captcha_flagged_multiplier", "captcha_login_failures", "captcha_login_window_minutes",
    "captcha_challenges_per_minute",
)
SECRET = "s" * 32


def test_defaults():
    s = Settings(_env_file=None)
    assert (s.captcha_mode, s.captcha_secret, s.captcha_ttl_seconds, s.captcha_cost, s.captcha_counter_max,
            s.captcha_flagged_multiplier, s.captcha_login_failures, s.captcha_login_window_minutes,
            s.captcha_challenges_per_minute) == ("off", "", 300, 1000, 10000, 2, 5, 15, 20)
    # 默认成本 1000 是桌面实测的结论(约 2.5 秒);工作量上限 10000 保持不变
    assert s.captcha_counter_max == 10000


def test_bounds():
    assert field_bounds("captcha_ttl_seconds") == (60, 1800)
    assert field_bounds("captcha_cost") == (1, 100000)
    assert field_bounds("captcha_counter_max") == (10, 1000000)
    assert field_bounds("captcha_flagged_multiplier") == (1, 10)
    assert field_bounds("captcha_login_failures") == (1, 100)
    assert field_bounds("captcha_login_window_minutes") == (1, 1440)
    assert field_bounds("captcha_challenges_per_minute") == (1, 1000)


def test_mode_choices():
    assert choices_for("captcha_mode") == ("off", "adaptive", "always")


def test_secret_is_env_only_and_secret():
    spec = SPECS["captcha_secret"]
    assert spec.env_only and spec.secret and spec.kind == "secret"
    assert "captcha_secret" in SECRETS


def test_secret_length_validated_without_echo():
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None, captcha_secret="short-secret")
    assert "short-secret" not in str(exc.value)
    assert Settings(_env_file=None, captcha_secret="").captcha_secret == ""
    assert Settings(_env_file=None, captcha_secret=SECRET).captcha_secret == SECRET


def test_all_captcha_keys_are_hot_in_registration_group():
    for key in CAPTCHA_KEYS:
        spec = SPECS[key]
        assert spec.group == "registration", key
        if key != "captcha_secret":
            assert spec.apply == "hot", key


def test_danger_strings_present():
    for key in ("captcha_mode", "captcha_cost", "captcha_counter_max", "captcha_login_failures"):
        assert SPECS[key].danger, key
