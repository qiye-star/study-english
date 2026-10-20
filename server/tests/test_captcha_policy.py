"""人机验证的纯策略表(计划 S4;spec §2 R-C1、R-C8,§3 端点策略)。"""
import itertools

import pytest

from app.core import captcha_policy as policy

MODES = ("off", "adaptive", "always")
SCOPES = ("register", "email_code", "reset", "login")


def test_required_table():
    for mode, scope, flagged in itertools.product(MODES, SCOPES, (False, True)):
        if mode == "off":
            expected = False
        elif scope in ("register", "email_code", "reset"):
            expected = True
        elif mode == "always":
            expected = True  # R-C1: always 下登录也必验
        else:  # adaptive, login: only once flagged (R-C8)
            expected = flagged
        assert policy.captcha_required(mode, scope, flagged) is expected, (mode, scope, flagged)


def test_unknown_scope_or_mode_raises():
    with pytest.raises(ValueError):
        policy.captcha_required("adaptive", "unknown", False)
    with pytest.raises(ValueError):
        policy.captcha_required("sometimes", "register", False)


def test_mode_is_on():
    assert policy.is_on("off") is False
    assert policy.is_on("adaptive") is True
    assert policy.is_on("always") is True
    with pytest.raises(ValueError):
        policy.is_on("maybe")
