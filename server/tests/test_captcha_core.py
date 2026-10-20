"""ALTCHA v2 适配(计划 S2 签发、S3 校验;spec 2026-10-20-captcha-altcha §6 与 R-C4、R-C5、R-C18–R-C20)。

时间:所有函数的 `now` 都是显式整数参数。官方库的过期检查直接读墙上时钟(`time.time()`),
所以测试里的时间戳必须落在真实"现在"之后;这里用 2096 年的固定整数,既不读时钟也不 monkeypatch 时钟。
"""
import ast
import base64
import json
import logging
import os
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


def _solved_payload_obj(challenge: dict) -> dict:
    solved = altcha.solve_challenge(altcha.Challenge.from_dict(challenge), counter_start=0)
    assert solved is not None
    return {"challenge": challenge, "solution": solved.to_dict()}


def _solved_payload(challenge: dict) -> str:
    """网页组件发来的 base64 载荷(X-Captcha 的值)。"""
    return _header(_solved_payload_obj(challenge))


def _header(obj: dict) -> str:
    return base64.b64encode(json.dumps(obj).encode()).decode()


# ---------------- S3: 校验(安全关键) ----------------


@pytest.fixture
def challenge():
    return captcha.issue(SECRET, cost=1, counter=5, ttl=TTL, now=NOW)


def test_valid_payload_verifies(challenge):
    header = _solved_payload(challenge)
    result = captcha.verify(header, SECRET, now=NOW)
    assert result is not None
    assert result.signature == challenge["signature"]
    assert result.expires_at == NOW + TTL
    assert type(result.solve_ms) is int
    assert 0 <= result.solve_ms <= 600000


@pytest.mark.parametrize("value", [None, "", "   "])
def test_rejects_none_and_empty(value):
    assert captcha.verify(value, SECRET, now=NOW) is None


def test_rejects_empty_secret(challenge):
    assert captcha.verify(_solved_payload(challenge), "", now=NOW) is None


def test_rejects_oversized_header():
    assert captcha.verify("A" * 4097, SECRET, now=NOW) is None


def test_rejects_non_base64():
    assert captcha.verify("!!!", SECRET, now=NOW) is None


def test_rejects_non_strict_base64(challenge):
    good = _solved_payload(challenge)
    broken = good[:8] + "\n" + good[8:]
    assert captcha.verify(broken, SECRET, now=NOW) is None


@pytest.mark.parametrize("raw", [b"[]", b"1", b"not json"])
def test_rejects_non_object_json(raw):
    header = base64.b64encode(raw).decode()
    assert captcha.verify(header, SECRET, now=NOW) is None


def test_rejects_wrong_secret(challenge):
    assert captcha.verify(_solved_payload(challenge), OTHER_SECRET, now=NOW) is None


def _tamper(obj: dict, key: str, value) -> dict:
    obj = json.loads(json.dumps(obj))
    obj["challenge"]["parameters"][key] = value
    return obj


@pytest.mark.parametrize("key,value", [("cost", 2), ("expiresAt", NOW + 299), ("keyPrefix", "00" * 16)])
def test_rejects_tampered_parameters(challenge, key, value):
    obj = _solved_payload_obj(challenge)
    assert captcha.verify(_header(obj), SECRET, now=NOW) is not None  # 基线:未篡改时通过
    assert captcha.verify(_header(_tamper(obj, key, value)), SECRET, now=NOW) is None


def test_rejects_tampered_signature(challenge):
    obj = _solved_payload_obj(challenge)
    sig = obj["challenge"]["signature"]
    flipped = sig[:-1] + ("0" if sig[-1] != "0" else "1")
    obj["challenge"]["signature"] = flipped
    assert captcha.verify(_header(obj), SECRET, now=NOW) is None


def test_rejects_wrong_solution(challenge):
    obj = _solved_payload_obj(challenge)
    dk = obj["solution"]["derivedKey"]
    obj["solution"]["derivedKey"] = dk[:-1] + ("0" if dk[-1] != "0" else "1")
    assert captcha.verify(_header(obj), SECRET, now=NOW) is None


def test_counter_tamper_is_not_checked_by_key_signature_path(challenge):
    # 库的快速路径(keySignature)只校验 derivedKey 的 HMAC,不重算 KDF,也就不看 counter。
    # 篡改 counter 不影响通过与否(不增加攻击面:签名 + derivedKey 才是被校验的部分)。
    obj = _solved_payload_obj(challenge)
    obj["solution"]["counter"] = obj["solution"]["counter"] + 1
    assert captcha.verify(_header(obj), SECRET, now=NOW) is not None


def test_rejects_expired(challenge):
    header = _solved_payload(challenge)
    assert captcha.verify(header, SECRET, now=NOW + TTL + 1) is None


def test_rejects_missing_expires_at():
    # 库不带 expiresAt 时会跳过自己的过期检查;我们自己的检查必须拦住
    c = altcha.create_challenge(
        captcha.ALGORITHM, 1, counter=5,
        hmac_secret=captcha.derived_keys(SECRET)[0], hmac_key_secret=captcha.derived_keys(SECRET)[1],
    ).to_dict()
    assert "expiresAt" not in c["parameters"]
    assert captcha.verify(_header(_solved_payload_obj(c)), SECRET, now=NOW) is None


def test_rejects_far_future_expiry():
    # 变异提示:删掉上限检查(now + MAX_TTL + SKEW)后,这里必须失败
    c = captcha.issue(SECRET, cost=1, counter=5, ttl=captcha.MAX_TTL_SECONDS + captcha.CLOCK_SKEW_SECONDS + 1, now=NOW)
    assert captcha.verify(_solved_payload(c), SECRET, now=NOW) is None


def test_rejects_other_algorithm():
    # 变异提示:删掉算法检查后,这里必须失败(库用 SHA-256 派生,能正常解出并通过签名)
    hmac_secret, hmac_key_secret = captcha.derived_keys(SECRET)
    c = altcha.create_challenge(
        "SHA-256", 1, counter=5, expires_at=NOW + TTL,
        hmac_secret=hmac_secret, hmac_key_secret=hmac_key_secret,
    ).to_dict()
    assert c["parameters"]["algorithm"] == "SHA-256"
    assert captcha.verify(_header(_solved_payload_obj(c)), SECRET, now=NOW) is None


def test_rejects_probabilistic_challenge_without_key_signature():
    hmac_secret, hmac_key_secret = captcha.derived_keys(SECRET)
    c = altcha.create_challenge(
        captcha.ALGORITHM, 1, expires_at=NOW + TTL,
        hmac_secret=hmac_secret, hmac_key_secret=hmac_key_secret,
    ).to_dict()
    assert "keySignature" not in c["parameters"]
    assert captcha.verify(_header(_solved_payload_obj(c)), SECRET, now=NOW) is None


def test_rejects_uppercase_or_short_signature(challenge):
    obj = _solved_payload_obj(challenge)
    upper = json.loads(json.dumps(obj))
    upper["challenge"]["signature"] = upper["challenge"]["signature"].upper()
    short = json.loads(json.dumps(obj))
    short["challenge"]["signature"] = short["challenge"]["signature"][:63]
    assert captcha.verify(_header(upper), SECRET, now=NOW) is None
    assert captcha.verify(_header(short), SECRET, now=NOW) is None


def test_rejects_bool_expires_at(challenge):
    obj = _solved_payload_obj(challenge)
    obj["challenge"]["parameters"]["expiresAt"] = True
    assert captcha.verify(_header(obj), SECRET, now=NOW) is None


def test_verify_never_raises():
    for _ in range(50):
        junk = base64.b64encode(os.urandom(64)).decode()
        assert captcha.verify(junk, SECRET, now=NOW) is None
        assert captcha.verify(base64.b64encode(json.dumps({"challenge": 1}).encode()).decode(), SECRET, now=NOW) is None


def test_verify_logs_nothing(challenge, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    header = _solved_payload(challenge)
    assert captcha.verify(header, SECRET, now=NOW) is not None
    assert captcha.verify(header + "x", SECRET, now=NOW) is None
    assert caplog.text == ""


def test_verified_repr_hides_signature(challenge):
    result = captcha.verify(_solved_payload(challenge), SECRET, now=NOW)
    assert result is not None
    assert challenge["signature"] not in repr(result)


def test_comparisons_do_not_touch_secret_material():
    banned = {"signature", "derivedKey", "keySignature", "derived_key", "key_signature", "hmac_secret"}
    tree = ast.parse(APP_CORE.read_text(encoding="utf-8"))
    hits = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare):
            for sub in ast.walk(node):
                if isinstance(sub, ast.Name) and sub.id in banned:
                    hits += 1
                if isinstance(sub, ast.Constant) and sub.value in banned:
                    hits += 1
    assert hits == 0
