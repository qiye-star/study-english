"""后台发信(计划 S15;spec §4.1、R-F6、INDEX X14、X15):模板、失败只计数、计量只记状态、可等待。"""
import asyncio
import logging
import re

import pytest

from app.core import metering
from app.core.metering import METER
from app.providers.email import EmailError, FakeSender
from app.services.mailer import CODE_KINDS, KINDS, Mailer, render
from tests.background import drain_background, live_tasks
from tests.conftest import make_settings

TO = "alice.recipient@example.com"
CODE = "483920"


@pytest.fixture(autouse=True)
def clean_meter():
    METER.drain()
    yield
    METER.drain()


def _mailer(sender, settings=None):
    settings = settings or make_settings(email_backend="console")
    return Mailer(lambda: settings, lambda: sender)


async def _wait(mailer):
    while mailer.pending:
        await asyncio.gather(*list(mailer.pending), return_exceptions=True)


async def test_enqueue_returns_at_once_and_the_task_is_awaitable():
    sender = FakeSender()
    mailer = _mailer(sender)
    mailer.enqueue("register_code", TO, code=CODE)
    assert len(mailer.pending) == 1
    assert sender.outbox == []  # nothing was sent inside enqueue itself
    await _wait(mailer)
    assert len(sender.outbox) == 1 and not mailer.pending
    to, subject, body = sender.outbox[0]
    assert to == TO and CODE in body and CODE not in subject
    assert sender.purposes == ["register"]


@pytest.mark.parametrize("lang", ["zh-CN", "en"])
@pytest.mark.parametrize("kind", sorted(KINDS))
def test_every_kind_has_a_template_in_both_languages(kind, lang):
    subject, body = render(kind, lang, CODE if kind in CODE_KINDS else None)
    assert subject.strip() and body.strip()
    assert "\r" not in subject and "\n" not in subject
    assert CODE not in subject
    assert (CODE in body) == (kind in CODE_KINDS)  # a notice never carries a code
    assert TO not in subject + body
    if lang == "zh-CN":
        assert re.search(r"[一-鿿]", subject) and re.search(r"[一-鿿]", body)
    else:
        assert not re.search(r"[一-鿿]", subject + body)


def test_kinds_are_the_five_from_the_plan():
    assert KINDS == {"register_code", "reset_code", "bind_code", "already_registered", "bind_conflict"}
    assert CODE_KINDS == {"register_code", "reset_code", "bind_code"}


def test_unknown_language_falls_back_to_chinese_and_kind_errors_are_programming_errors():
    assert render("register_code", "fr", CODE) == render("register_code", "zh-CN", CODE)
    with pytest.raises(ValueError):
        render("nope", "en", None)
    with pytest.raises(ValueError):
        render("register_code", "en", None)  # a code kind needs its code


async def test_enqueue_validates_before_spawning():
    mailer = _mailer(FakeSender())
    with pytest.raises(ValueError):
        mailer.enqueue("nope", TO)
    with pytest.raises(ValueError):
        mailer.enqueue("reset_code", TO)
    assert not mailer.pending


async def test_send_failure_is_counted_and_logged_without_the_address(caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    sender = FakeSender(fail_with=EmailError("auth", 535))
    mailer = _mailer(sender)
    mailer.enqueue("reset_code", TO, code=CODE)
    await _wait(mailer)
    assert mailer.failures == 1
    messages = [r.getMessage() for r in caplog.records if r.name.startswith("app")]
    assert messages == ["email send failed code=auth"]
    assert TO not in caplog.text and CODE not in caplog.text and "example.com" not in caplog.text


async def test_an_unexpected_exception_never_escapes_the_task(caplog):
    caplog.set_level(logging.DEBUG, logger="app")

    class Boom:
        async def send(self, to, subject, body, *, purpose):
            raise RuntimeError(f"secret detail {to}")

    mailer = _mailer(Boom())
    mailer.enqueue("register_code", TO, code=CODE)
    await _wait(mailer)
    assert mailer.failures == 1
    assert TO not in caplog.text and "secret detail" not in caplog.text


async def test_no_backend_means_no_send_and_a_counted_failure(caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    mailer = Mailer(lambda: make_settings(email_backend="off"), lambda: None)
    mailer.enqueue("register_code", TO, code=CODE)
    await _wait(mailer)
    assert mailer.failures == 1
    assert METER.drain() == []
    assert TO not in caplog.text


async def test_metering_records_status_only_never_recipient_or_text():
    sender = FakeSender()
    mailer = _mailer(sender, make_settings(email_backend="smtp"))
    mailer.enqueue("register_code", TO, code=CODE)
    await _wait(mailer)
    (rec,) = METER.drain()
    assert (rec.kind, rec.provider, rec.model, rec.status, rec.unit) == ("email", "smtp", "-", 200, "calls")
    blob = repr(rec)
    for forbidden in (TO, CODE, "example.com", "alice"):
        assert forbidden not in blob


async def test_metering_records_the_smtp_reply_code_or_zero():
    for error, status in ((EmailError("auth", 535), 535), (EmailError("timeout"), 0), (EmailError("network"), 0)):
        mailer = _mailer(FakeSender(fail_with=error), make_settings(email_backend="smtp"))
        mailer.enqueue("bind_code", TO, code=CODE)
        await _wait(mailer)
        (rec,) = METER.drain()
        assert rec.status == status and rec.kind == "email"


async def test_console_backend_is_labelled_console():
    mailer = _mailer(FakeSender(), make_settings(email_backend="console"))
    mailer.enqueue("already_registered", TO)
    await _wait(mailer)
    assert METER.drain()[0].provider == "console"


async def test_the_task_inherits_the_request_feature_scope():
    mailer = _mailer(FakeSender())
    with metering.feature_scope("account"):
        mailer.enqueue("already_registered", TO)
    await _wait(mailer)
    assert METER.drain()[0].feature == "account"


async def test_settings_are_read_when_the_mail_goes_out():
    sender = FakeSender()
    box = {"settings": make_settings(email_backend="console")}
    mailer = Mailer(lambda: box["settings"], lambda: sender)
    mailer.enqueue("register_code", TO, code=CODE, lang="en")
    box["settings"] = make_settings(email_backend="smtp")  # hot change before the task runs
    await _wait(mailer)
    assert METER.drain()[0].provider == "smtp"


def test_metering_knows_the_email_kind_and_routes():
    assert "email" in metering.KINDS
    assert metering.DAILY_UNIT["email"] == "calls"
    for path in ("/api/email/code", "/api/me/email/code", "/api/me/email"):
        assert metering.feature_for(path) == "account", path
    assert metering.feature_for("/api/me") == "other"
    assert metering.feature_for("/api/emailx") == "other"


async def test_app_has_a_mailer_that_background_helpers_wait_for(app):
    mailer = app.state.mailer
    sender = FakeSender()
    app.state.email_sender_override = sender
    mailer.enqueue("register_code", TO, code=CODE)
    assert any(t for t in live_tasks(app))  # the helper sees the pending task
    await drain_background(app)
    assert len(sender.outbox) == 1
    assert not mailer.pending
