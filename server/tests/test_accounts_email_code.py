"""POST /api/email/code(计划 S16;spec §4.1、INDEX X9、X10、R-F5、R-F6):发码不泄露「是否已注册」。"""
import asyncio
import logging
import re
import time

import pytest
from sqlalchemy import select

from app.core.metering import METER
from app.models import EmailDailyCount, UserIdentity, VerificationCode
from tests.accounts_helpers import PEPPER, age_codes, bind, contains_code, enable_email, fake_sender, last_code
from tests.background import drain_background
from tests.test_admin_api import register

NEW = "newcomer@example.com"
KNOWN = "known.user@example.com"
OK = {"ok": True, "cooldown_seconds": 60}


@pytest.fixture(autouse=True)
def clean_meter():
    METER.drain()
    yield
    METER.drain()


async def _post(client, email, purpose="register", **headers):
    return await client.post("/api/email/code", json={"email": email, "purpose": purpose}, headers=headers)


async def _known_user(app, client, email=KNOWN, name="known"):
    uid, _ = await register(client, name)
    await bind(app, uid, email)
    return uid


async def test_register_code_for_new_email_is_sent(app, client):
    enable_email(app)
    r = await _post(client, NEW)
    assert r.status_code == 200 and r.json() == OK
    await drain_background(app)
    (to, subject, body), = fake_sender(app).outbox
    assert to == NEW and re.search(r"\b\d{6}\b", body) and not re.search(r"\d{6}", subject)
    assert fake_sender(app).purposes == ["register"]


async def test_register_code_for_registered_email_sends_notice_not_code(app, client):
    enable_email(app)
    await _known_user(app, client)
    fresh = await _post(client, NEW)
    known = await _post(client, KNOWN)
    assert known.status_code == 200
    assert known.content == fresh.content  # byte for byte the same answer
    assert known.headers.get("content-type") == fresh.headers.get("content-type")
    await drain_background(app)
    outbox = fake_sender(app).outbox
    assert [m[0] for m in outbox] == [NEW, KNOWN]
    assert re.search(r"\b\d{6}\b", outbox[0][2])
    assert not re.search(r"\d{6}", outbox[1][1] + outbox[1][2])  # the notice carries no code
    assert fake_sender(app).purposes == ["register", "notice_registered"]


async def test_plus_tag_and_case_variants_count_as_the_registered_email(app, client):
    enable_email(app)
    await _known_user(app, client)
    assert (await _post(client, "Known.User+promo@EXAMPLE.com")).status_code == 200
    await drain_background(app)
    (to, _s, body), = fake_sender(app).outbox
    assert to == KNOWN  # the notice goes to the STORED address, never to the typed variant (F1)
    assert not re.search(r"\d{6}", body)


async def test_reset_code_goes_to_the_stored_address_not_the_typed_variant(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    enable_email(app)
    await _known_user(app, client, email="bob@x.test", name="bob")
    good = await _post(client, "bob@x.test", "reset")
    await drain_background(app)
    await age_codes(app, seconds=61)
    typed = "bob+x@x.test"  # on another mail system `+` is an ordinary character: someone else's mailbox
    variant = await _post(client, typed, "reset")
    assert variant.status_code == good.status_code == 200 and variant.content == good.content
    await drain_background(app)
    assert [m[0] for m in fake_sender(app).outbox] == ["bob@x.test", "bob@x.test"]
    assert fake_sender(app).purposes == ["reset", "reset"]
    assert typed not in caplog.text and "bob@x.test" not in caplog.text


async def test_registered_notice_goes_to_the_stored_address_not_the_typed_variant(app, client):
    enable_email(app)
    await _known_user(app, client, email="bob@x.test", name="bob")
    assert (await _post(client, "bob+x@x.test", "register")).status_code == 200
    await drain_background(app)
    assert [m[0] for m in fake_sender(app).outbox] == ["bob@x.test"]
    assert fake_sender(app).purposes == ["notice_registered"]


async def test_unknown_reset_address_sends_nothing(app, client):
    enable_email(app)
    await _known_user(app, client, email="bob@x.test", name="bob")
    known = await _post(client, "bob@x.test", "reset")
    unknown = await _post(client, "carol+x@x.test", "reset")
    assert unknown.status_code == 200 and unknown.content == known.content
    await drain_background(app)
    assert [m[0] for m in fake_sender(app).outbox] == ["bob@x.test"]


async def test_reset_code_for_known_email_is_sent_and_for_unknown_nothing_but_the_same_answer(app, client):
    enable_email(app)
    await _known_user(app, client)
    known = await _post(client, KNOWN, "reset")
    unknown = await _post(client, "nobody@example.com", "reset")
    assert known.status_code == unknown.status_code == 200
    assert known.content == unknown.content
    await drain_background(app)
    (to, _s, body), = fake_sender(app).outbox
    assert to == KNOWN and re.search(r"\b\d{6}\b", body)
    assert fake_sender(app).purposes == ["reset"]
    async with app.state.sessionmaker() as s:  # the unknown address still got a (never sent) row
        rows = (await s.execute(select(VerificationCode))).scalars().all()
    assert sorted(r.purpose for r in rows) == ["reset", "reset"]


@pytest.mark.parametrize("purpose", ["register", "reset"])
async def test_cooldown_and_daily_cap_are_429_for_registered_and_unknown_alike(app, client, purpose):
    enable_email(app, email_codes_per_target_daily=2)
    await _known_user(app, client)
    statuses = {}
    for label, email in (("known", KNOWN), ("unknown", "unknown.person@example.com")):
        assert (await _post(client, email, purpose)).status_code == 200
        again = await _post(client, email, purpose)  # inside the 60 s cooldown
        assert again.status_code == 429
        assert again.json() == {"error": "Too many codes, please wait"}
        assert 1 <= int(again.headers["retry-after"]) <= 60
        statuses[label] = (again.status_code, again.content)
    assert statuses["known"] == statuses["unknown"]

    await age_codes(app, seconds=61)
    for email in (KNOWN, "unknown.person@example.com"):
        assert (await _post(client, email, purpose)).status_code == 200  # the 2nd code of the day
    await age_codes(app, seconds=61)
    answers = []
    for email in (KNOWN, "unknown.person@example.com"):
        r = await _post(client, email, purpose)  # the 3rd would exceed the per-target cap of 2
        assert r.status_code == 429 and int(r.headers["retry-after"]) > 60
        answers.append(r.content)
    assert answers[0] == answers[1]


async def test_ip_hourly_cap_is_429(app, client):
    enable_email(app, email_codes_per_ip_hourly=2)
    assert (await _post(client, "a1@example.com")).status_code == 200
    assert (await _post(client, "a2@example.com")).status_code == 200
    r = await _post(client, "a3@example.com")
    assert r.status_code == 429 and r.json() == {"error": "Too many codes, please wait"}


async def test_ip_cap_is_hot(app, client):
    enable_email(app, email_codes_per_ip_hourly=1000)
    assert app.state.email_ip_limiter.limit == 1000
    assert app.state.email_ip_limiter.window == 3600.0


async def test_global_cap_is_503_and_does_not_reveal_registration(app, client):
    enable_email(app, email_daily_global=1)
    await _known_user(app, client)
    assert (await _post(client, NEW)).status_code == 200  # takes the only unit of today's quota
    answers = []
    for email, purpose in ((KNOWN, "register"), ("stranger@example.com", "register"),
                           (KNOWN, "reset"), ("stranger@example.com", "reset")):
        r = await _post(client, email, purpose)
        assert r.status_code == 503, (email, purpose)
        assert r.json() == {"error": "Email temporarily unavailable"}
        answers.append(r.content)
    assert len(set(answers)) == 1
    async with app.state.sessionmaker() as s:
        assert (await s.execute(select(EmailDailyCount))).scalar_one().sent == 1


async def test_a_notice_mail_takes_global_quota_too(app, client):
    enable_email(app, email_daily_global=1)
    await _known_user(app, client)
    assert (await _post(client, KNOWN)).status_code == 200  # a notice, but still one mail
    assert (await _post(client, NEW)).status_code == 503


async def test_an_unknown_reset_takes_no_quota(app, client):
    enable_email(app, email_daily_global=1)
    for i in range(3):
        assert (await _post(client, f"ghost{i}@example.com", "reset")).status_code == 200
    assert (await _post(client, NEW)).status_code == 200
    await drain_background(app)
    assert len(fake_sender(app).outbox) == 1


async def test_blocked_domain_is_422(app, client):
    enable_email(app)
    r = await _post(client, "someone@mailinator.com")
    assert r.status_code == 422 and r.json() == {"error": "Email domain not allowed"}
    assert "mailinator" not in r.text
    await drain_background(app)
    assert fake_sender(app).outbox == []


async def test_domain_policy_applies_to_reset_too(app, client):
    enable_email(app, email_domain_mode="allowlist")
    assert (await _post(client, "someone@gmail.com", "reset")).status_code == 422
    assert (await _post(client, "someone@qq.com", "reset")).status_code == 200


@pytest.mark.parametrize("overrides", [
    {},  # nothing configured at all
    {"identity_pepper": ""},
    {"settings_encryption_key": ""},
    {"email_backend": "off"},
])
async def test_email_not_configured_is_503(app, client, overrides):
    if overrides:
        enable_email(app, **overrides)
    r = await _post(client, NEW)
    assert r.status_code == 503 and r.json() == {"error": "Email is not configured"}
    async with app.state.sessionmaker() as s:
        assert (await s.execute(select(VerificationCode))).first() is None


@pytest.mark.parametrize("purpose", ["bind", "change_email", "delete", ""])
async def test_purpose_must_be_register_or_reset(app, client, purpose):
    enable_email(app)
    r = await _post(client, NEW, purpose)
    assert r.status_code == 422
    assert NEW not in r.text


@pytest.mark.parametrize("bad", ["", "not-an-email", "a@b", "a b@example.com", "a@example.com\r\nBcc: x@example.com",
                                 "邮箱@example.com", "x" * 300 + "@example.com"])
async def test_invalid_email_is_422_without_echo(app, client, bad):
    enable_email(app)
    r = await _post(client, bad)
    assert r.status_code == 422
    assert "Bcc" not in r.text and "not-an-email" not in r.text and "邮箱" not in r.text


async def test_the_response_does_not_wait_for_the_mail(app, client):
    """The SMTP round trip happens in a background task, so registered and unknown addresses answer equally fast."""
    sender = enable_email(app)
    gate = asyncio.Event()
    real_send = sender.send

    async def slow_send(*args, **kwargs):
        await gate.wait()
        return await real_send(*args, **kwargs)

    sender.send = slow_send  # type: ignore[method-assign]
    await _known_user(app, client)
    for email in (NEW, KNOWN):
        started = time.perf_counter()
        r = await asyncio.wait_for(_post(client, email), timeout=2.0)
        assert r.status_code == 200
        assert time.perf_counter() - started < 1.0
    assert len(app.state.mailer.pending) == 2  # both mails are still waiting on the gate
    gate.set()
    await drain_background(app)
    assert len(sender.outbox) == 2


async def test_the_database_never_holds_the_address_or_the_code(app, client):
    enable_email(app)
    await _known_user(app, client)
    await _post(client, NEW)
    await _post(client, "second.person@example.com", "reset")
    await drain_background(app)
    code = last_code(app, NEW)
    async with app.state.sessionmaker() as s:
        rows = (await s.execute(select(VerificationCode))).scalars().all()
        identities = (await s.execute(select(UserIdentity))).scalars().all()
    dump = " ".join(str(vars(r)) for r in rows + identities)
    assert not contains_code(dump, code)
    for plain in ("newcomer", "second.person", "known.user", "example.com"):
        assert plain not in dump
    assert PEPPER not in dump


def test_contains_code_flags_codes_glued_to_letters_and_ignores_hex_digests():
    assert contains_code("code=123456", "123456") and contains_code('"123456"', "123456")
    assert contains_code("code123456", "123456")  # glued to letters: still a leak
    digest = "9a" * 10 + "123456" + "fe" * 19  # a 64-hex-char HMAC that happens to contain the code
    assert len(digest) == 64 and not contains_code(digest, "123456")
    assert not contains_code("1234567", "123456") and not contains_code("hmac 9a1234567b", "123456")


async def test_every_send_is_metered_with_status_only(app, client):
    enable_email(app)
    await _post(client, NEW)
    await drain_background(app)
    records = [r for r in METER.drain() if r.kind == "email"]
    assert len(records) == 1
    rec = records[0]
    assert (rec.provider, rec.model, rec.status, rec.feature) == ("console", "-", 200, "account")
    assert "example.com" not in repr(rec)


async def test_email_code_logs_no_email_or_code(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    enable_email(app, email_codes_per_target_daily=1, email_daily_global=2)
    await _known_user(app, client)
    for email, purpose in ((NEW, "register"), (KNOWN, "register"), ("ghost@example.com", "reset"),
                           (NEW, "register"),  # cooldown
                           ("x@mailinator.com", "register"),  # blocked domain
                           ("third@example.com", "register")):  # global cap
        await _post(client, email, purpose)
    await drain_background(app)
    code = last_code(app, NEW)
    text = caplog.text
    assert not contains_code(text, code) and "example.com" not in text and "mailinator" not in text
    for plain in ("newcomer", "known.user", "ghost", PEPPER):
        assert plain not in text


async def test_email_code_precedes_stubs(app, client):
    r = await client.post("/api/email/code", json={"email": NEW, "purpose": "register"})
    assert r.json() != {}  # the stubs router would swallow it with {}
    assert r.status_code == 503  # email is off in the default test app


async def test_a_send_failure_does_not_change_the_answer(app, client):
    from app.providers.email import EmailError

    sender = enable_email(app)
    sender.fail_with = EmailError("auth", 535)
    r = await _post(client, NEW)
    assert r.status_code == 200 and r.json() == OK
    await drain_background(app)
    assert app.state.mailer.failures == 1
