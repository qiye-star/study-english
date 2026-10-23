"""captcha_guard.enforce()(计划 S9;spec §6.3、§6.4、R-C2、R-C9、R-C14、R-C22)。

`enforce` 不是路由,所以这里直接用 starlette.Request 构造请求对象调用它(请求头、app 对象即可),
不经过路由表;路由接入在 S10 的 account 测试里覆盖。时间:挑战用真实的 time.time()。
"""
import base64
import json
import logging
import re
import time

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from starlette.requests import Request

from app.core import captcha
from app.models import CaptchaReplay
from app.routers.captcha_guard import CAPTCHA_INVALID, CAPTCHA_NOT_CONFIGURED, CAPTCHA_REQUIRED, enforce
from tests.captcha_helpers import SECRET, enable_captcha, solve

OTHER_SECRET = "other-captcha-secret-" + "y" * 20


def _request(app, header: str | None = None) -> Request:
    headers = [(b"x-captcha", header.encode())] if header is not None else []
    scope = {"type": "http", "method": "POST", "path": "/", "query_string": b"", "headers": headers,
             "client": ("127.0.0.1", 1), "app": app}
    return Request(scope)


def _fresh_header(secret: str = SECRET, ttl: int = 300) -> str:
    challenge = captcha.issue(secret, cost=1, counter=7, ttl=ttl, now=int(time.time()))
    return solve(challenge)


async def _count(app) -> int:
    async with app.state.sessionmaker() as session:
        return (await session.execute(select(func.count()).select_from(CaptchaReplay))).scalar_one()


async def _enforce(app, scope: str, header: str | None, *, flagged: bool = False) -> None:
    async with app.state.sessionmaker() as session:
        await enforce(_request(app, header), session, scope, flagged=flagged)


async def _expect(app, scope: str, header: str | None, status: int, detail: str, *, flagged: bool = False) -> None:
    with pytest.raises(HTTPException) as info:
        await _enforce(app, scope, header, flagged=flagged)
    assert info.value.status_code == status
    assert info.value.detail == detail


async def test_off_mode_never_checks(app):
    await _enforce(app, "register", None)
    await _enforce(app, "register", "garbage!!")
    assert await _count(app) == 0


async def test_not_required_ignores_header(app):
    enable_captcha(app, "adaptive")
    await _enforce(app, "login", _fresh_header(), flagged=False)  # a valid header is ignored...
    assert await _count(app) == 0  # ...and nothing is claimed


async def test_flagged_login_requires_a_captcha(app):
    enable_captcha(app, "adaptive")
    await _expect(app, "login", None, 428, CAPTCHA_REQUIRED, flagged=True)


async def test_missing_secret_fails_closed(app):
    enable_captcha(app, "adaptive", captcha_secret="")
    await _expect(app, "register", None, 503, CAPTCHA_NOT_CONFIGURED)
    await _expect(app, "register", _fresh_header(), 503, CAPTCHA_NOT_CONFIGURED)
    enable_captcha(app, "off", captcha_secret="")
    await _enforce(app, "register", None)  # off with no secret: allowed through (only off lets requests pass)


async def test_missing_header_is_captcha_required(app):
    enable_captcha(app, "adaptive")
    for header in (None, "", "   "):
        await _expect(app, "register", header, 428, CAPTCHA_REQUIRED)
    assert await _count(app) == 0


async def test_bad_header_is_captcha_invalid(app):
    enable_captcha(app, "adaptive")
    await _expect(app, "register", "garbage!!", 428, CAPTCHA_INVALID)
    assert await _count(app) == 0


async def test_valid_header_passes_once(app):
    enable_captcha(app, "adaptive")
    header = _fresh_header()
    await _enforce(app, "register", header)  # first use passes
    assert await _count(app) == 1  # committed: visible from a new session
    await _expect(app, "register", header, 428, CAPTCHA_INVALID)  # second use is a replay


async def test_forged_payload_writes_nothing(app):
    enable_captcha(app, "adaptive")
    obj = json.loads(base64.b64decode(_fresh_header()))
    sig = obj["challenge"]["signature"]
    obj["challenge"]["signature"] = ("0" if sig[0] != "0" else "1") + sig[1:]
    forged = base64.b64encode(json.dumps(obj).encode()).decode()
    await _expect(app, "register", forged, 428, CAPTCHA_INVALID)
    assert await _count(app) == 0


async def test_expired_header_is_invalid(app, monkeypatch):
    enable_captcha(app, "adaptive")
    header = _fresh_header(ttl=300)
    real = time.time
    monkeypatch.setattr(time, "time", lambda: real() + 301)
    await _expect(app, "register", header, 428, CAPTCHA_INVALID)
    assert await _count(app) == 0


async def test_header_from_other_secret_is_invalid(app):
    enable_captcha(app, "adaptive")
    await _expect(app, "register", _fresh_header(secret=OTHER_SECRET), 428, CAPTCHA_INVALID)
    assert await _count(app) == 0


async def test_timing_line_numbers_only(app, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    enable_captcha(app, "adaptive")
    await _enforce(app, "register", _fresh_header())
    timing = [r.getMessage() for r in caplog.records if r.name == "app.timing"]
    assert len(timing) == 1
    assert re.fullmatch(r"timing event=captcha_verify scope=register solve_ms=\d+", timing[0]), timing[0]


async def test_guard_logs_no_payload(app, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    enable_captcha(app, "adaptive")
    header = _fresh_header()
    obj = json.loads(base64.b64decode(header))
    hmac_secret, hmac_key_secret = captcha.derived_keys(SECRET)
    params = obj["challenge"]["parameters"]
    await _enforce(app, "register", header)  # success
    with pytest.raises(HTTPException):
        await _enforce(app, "register", header)  # replay
    with pytest.raises(HTTPException):
        await _enforce(app, "register", "garbage!!")
    secrets_seen = [SECRET, hmac_secret, hmac_key_secret, header, obj["challenge"]["signature"],
                    params["nonce"], params["salt"], params["keySignature"], json.dumps(obj["solution"])]
    for value in secrets_seen:
        assert value and value not in caplog.text
