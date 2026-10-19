"""Invites v2 settings and the per-user cap quota key (plan 2026-10-14-invites-v2 S2; INDEX §4.1 X19)."""
from pathlib import Path

import pytest

from app.admin.users_admin import operator_ceiling
from app.core.config import Settings
from app.core.quotas import QUOTA_KEYS
from app.core.settings_registry import SPECS, spec_for

ROOT = Path(__file__).resolve().parent.parent

NEW_KEYS = ("invites_user_code_max_uses", "invites_user_min_account_days", "invite_failures_per_ip_hourly")


@pytest.mark.parametrize("key", NEW_KEYS)
def test_new_invite_settings_are_hot_registration_ints(key):
    spec = spec_for(key)
    assert spec.group == "registration" and spec.kind == "int" and spec.apply == "hot"
    assert not spec.env_only and not spec.secret


def test_defaults_and_bounds_match_the_plan():
    s = Settings(_env_file=None)
    assert (s.invites_user_code_max_uses, s.invites_user_min_account_days, s.invite_failures_per_ip_hourly) == (10, 7, 5)
    assert spec_for("invites_user_code_max_uses").min == 0 and spec_for("invites_user_code_max_uses").max == 1000
    assert spec_for("invites_user_min_account_days").min == 0 and spec_for("invites_user_min_account_days").max == 365
    assert spec_for("invite_failures_per_ip_hourly").min == 1 and spec_for("invite_failures_per_ip_hourly").max == 1000
    for key in NEW_KEYS:
        assert key in SPECS


def test_user_code_cap_is_a_quota_key_and_its_operator_ceiling_is_100():
    assert QUOTA_KEYS["invites_user_code_max_uses"] == "invites_user_code_max_uses"
    assert operator_ceiling(Settings(_env_file=None), "invites_user_code_max_uses") == 100


def test_inline_invite_code_is_marked_as_not_recommended():
    spec = spec_for("invite_code")
    assert "不推荐" in spec.help_zh and "无归属" in spec.help_zh and "不可单独撤销" in spec.help_zh


def test_env_example_documents_each_new_setting_with_a_chinese_comment():
    lines = (ROOT / ".env.example").read_text(encoding="utf-8").splitlines()
    for key in NEW_KEYS:
        idx = next(i for i, line in enumerate(lines) if line.startswith(f"{key.upper()}="))
        comment = lines[idx - 1]
        assert comment.startswith("#") and any("一" <= ch <= "鿿" for ch in comment), key
