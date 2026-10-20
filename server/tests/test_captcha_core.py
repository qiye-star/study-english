"""ALTCHA v2 适配(计划 S2 签发、S3 校验;spec 2026-10-20-captcha-altcha §6 与 R-C4、R-C5、R-C18–R-C20)。

时间:所有函数的 `now` 都是显式整数参数。官方库的过期检查直接读墙上时钟(`time.time()`),
所以测试里的时间戳必须落在真实"现在"之后;这里用 2096 年的固定整数,既不读时钟也不 monkeypatch 时钟。
"""
import ast
import json
import re
from pathlib import Path

import altcha
import pytest

from app.core import captcha

SECRET = "s" * 32
OTHER_SECRET = "t" * 32
NOW = 4_000_000_000  # 固定的未来整数时间(见模块文档字符串)
TTL = 300
APP_CORE = Path(captcha.__file__)


# ---------------- S2: 签发 ----------------


def test_issue_shape():
    c = captcha.issue(SECRET, cost=1, counter=5, ttl=TTL, now=NOW)
    assert set(c) == {"parameters", "signature"}
    p = c["parameters"]
    assert p["algorithm"] == "PBKDF2/SHA-256"
    assert p["cost"] == 1
    assert p["expiresAt"] == NOW + TTL
    assert isinstance(p["keySignature"], str) and p["keySignature"]
    assert isinstance(p["keyPrefix"], str) and p["keyPrefix"]
    assert isinstance(p["nonce"], str) and isinstance(p["salt"], str)
    assert re.fullmatch(r"[0-9a-f]{64}", c["signature"])


def test_issue_is_solvable_by_the_official_solver():
    c = captcha.issue(SECRET, cost=1, counter=7, ttl=TTL, now=NOW)
    solved = altcha.solve_challenge(altcha.Challenge.from_dict(c), counter_start=0)
    assert solved is not None
    assert solved.counter == 7


def test_two_issues_differ():
    a = captcha.issue(SECRET, cost=1, counter=5, ttl=TTL, now=NOW)
    b = captcha.issue(SECRET, cost=1, counter=5, ttl=TTL, now=NOW)
    assert a["parameters"]["nonce"] != b["parameters"]["nonce"]
    assert a["signature"] != b["signature"]


def test_secret_and_derived_keys_not_in_challenge():
    c = captcha.issue(SECRET, cost=1, counter=5, ttl=TTL, now=NOW)
    text = json.dumps(c)
    hmac_secret, hmac_key_secret = captcha.derived_keys(SECRET)
    assert SECRET not in text
    assert hmac_secret not in text
    assert hmac_key_secret not in text


def test_derived_keys_are_hex_and_distinct():
    a, b = captcha.derived_keys(SECRET)
    assert re.fullmatch(r"[0-9a-f]{64}", a)
    assert re.fullmatch(r"[0-9a-f]{64}", b)
    assert a != b
    assert captcha.derived_keys(OTHER_SECRET) != (a, b)


def test_issue_refuses_empty_secret():
    # 空密钥派生出的密钥是公开常量;必须失败即关闭,而不是签一个可伪造的挑战
    with pytest.raises(ValueError):
        captcha.issue("", cost=1, counter=5, ttl=TTL, now=NOW)


def test_pick_counter_range_and_flag(monkeypatch):
    # 固定 secrets.randbelow 的结果,检查两端与倍数
    monkeypatch.setattr(captcha.secrets, "randbelow", lambda n: 0)
    assert captcha.pick_counter(10000, 2, flagged=False) == 5000
    assert captcha.pick_counter(10000, 2, flagged=True) == 10000
    monkeypatch.setattr(captcha.secrets, "randbelow", lambda n: n - 1)
    assert captcha.pick_counter(10000, 2, flagged=False) == 10000
    assert captcha.pick_counter(10000, 2, flagged=True) == 20000


def test_pick_counter_small_and_capped(monkeypatch):
    monkeypatch.setattr(captcha.secrets, "randbelow", lambda n: 0)
    assert captcha.pick_counter(10, 1, flagged=False) >= 5
    assert captcha.pick_counter(1_000_000, 10, flagged=True) <= 0xFFFFFFFF
    assert captcha.pick_counter(10, 1, flagged=False) >= 1


def test_pick_counter_stays_in_bounds_for_real_randomness():
    for _ in range(200):
        value = captcha.pick_counter(10000, 2, flagged=False)
        assert 5000 <= value <= 10000


def test_core_module_has_no_clock_reads():
    tree = ast.parse(APP_CORE.read_text(encoding="utf-8"))
    banned = {"time", "monotonic", "perf_counter"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr in banned:
            raise AssertionError(f"core/captcha.py reads a clock: .{node.attr} at line {node.lineno}")
    assert "datetime" not in APP_CORE.read_text(encoding="utf-8")
