"""发信后端(计划 S12;spec §4.2、R-F1 头注入、INDEX X22):smtplib 全部用记录型假类替换,不连网。"""
import logging
import smtplib
import socket
import ssl

import pytest

from app.providers import email as email_provider
from app.providers.email import ConsoleSender, EmailError, FakeSender, SmtpSender, sender_for
from tests.conftest import make_settings

SECRET = "authcode-SECRET-123"
TO = "alice.recipient@example.com"


class FakeSmtp:
    """Records every call. `plan` customises failures per step name: {"login": exception}."""
    instances: list = []
    plan: dict = {}

    def __init__(self, host, port, *args, **kwargs):
        self.host, self.port, self.kwargs = host, port, kwargs
        self.calls: list = []
        self.sent: list = []
        type(self).instances.append(self)
        self._maybe_raise("connect")

    def _maybe_raise(self, name):
        exc = type(self).plan.get(name)
        if exc is not None:
            raise exc

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def ehlo(self):
        self.calls.append(("ehlo",))

    def starttls(self, **kwargs):
        self.calls.append(("starttls", kwargs.get("context") is not None))
        self._maybe_raise("starttls")

    def login(self, user, password):
        self.calls.append(("login", user, password))
        self._maybe_raise("login")

    def send_message(self, msg, *args, **kwargs):
        self.calls.append(("send_message",))
        self.sent.append(msg)
        self._maybe_raise("send_message")


@pytest.fixture
def smtp(monkeypatch):
    FakeSmtp.instances = []
    FakeSmtp.plan = {}
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSmtp)
    monkeypatch.setattr(smtplib, "SMTP", FakeSmtp)
    return FakeSmtp


def _settings(**kw):
    base = dict(email_backend="smtp", smtp_host="smtp.example.test", smtp_port=465, smtp_security="ssl",
                smtp_user="noreply@example.test", smtp_password=SECRET, smtp_from="")
    base.update(kw)
    return make_settings(**base)


async def test_smtp_ssl_sends_one_message_with_fixed_headers(smtp):
    sender = SmtpSender(_settings())
    await sender.send(TO, "Your code", "Code: 123456\n", purpose="register")
    assert len(smtp.instances) == 1
    conn = smtp.instances[0]
    assert (conn.host, conn.port) == ("smtp.example.test", 465)
    assert conn.kwargs.get("timeout") == 10
    assert conn.kwargs.get("context") is not None  # ssl.create_default_context()
    assert ("login", "noreply@example.test", SECRET) in conn.calls
    assert [c for c in conn.calls if c[0] == "send_message"] == [("send_message",)]
    msg = conn.sent[0]
    assert msg["From"] == "noreply@example.test"  # smtp_from empty -> smtp_user
    assert msg["To"] == TO
    assert msg["Subject"] == "Your code"
    assert msg.get_content_type() == "text/plain"
    assert msg.get_content_charset() == "utf-8"
    assert 'charset="utf-8"' in msg["Content-Type"]
    assert msg.get_content().strip() == "Code: 123456"


async def test_smtp_from_overrides_the_login_user(smtp):
    await SmtpSender(_settings(smtp_from="hello@example.test")).send(TO, "s", "b", purpose="reset")
    assert smtp.instances[0].sent[0]["From"] == "hello@example.test"


async def test_non_ascii_body_and_subject_are_utf8(smtp):
    await SmtpSender(_settings()).send(TO, "验证码", "您的验证码是 123456", purpose="register")
    msg = smtp.instances[0].sent[0]
    assert msg.get_content_charset() == "utf-8"
    assert "您的验证码是 123456" in msg.get_content()
    assert msg["Subject"] == "验证码"


async def test_starttls_path_calls_starttls_before_login(smtp):
    await SmtpSender(_settings(smtp_security="starttls", smtp_port=587)).send(TO, "s", "b", purpose="register")
    conn = smtp.instances[0]
    assert (conn.host, conn.port) == ("smtp.example.test", 587)
    names = [c[0] for c in conn.calls]
    assert names.index("starttls") < names.index("login") < names.index("send_message")
    assert ("starttls", True) in conn.calls


@pytest.mark.parametrize("to, subject", [
    ("a@example.com\r\nBcc: evil@example.com", "s"),
    ("a@example.com\nBcc: evil@example.com", "s"),
    ("a@example.com ", "s"),
    ("a b@example.com", "s"),
    ("a@example.com\t", "s"),
    ("", "s"),
    (TO, "hello\r\nBcc: evil@example.com"),
    (TO, "hello\nworld"),
])
async def test_rejects_header_injection(smtp, to, subject):
    with pytest.raises(EmailError) as info:
        await SmtpSender(_settings()).send(to, subject, "b", purpose="register")
    assert info.value.code == "invalid"
    assert smtp.instances == []  # no connection was opened
    assert "evil" not in str(info.value) and "example.com" not in str(info.value)


async def test_rejects_an_injected_from_address(smtp):
    with pytest.raises(EmailError) as info:
        await SmtpSender(_settings(smtp_from="a@example.test\r\nBcc: x@example.test")).send(TO, "s", "b", purpose="x")
    assert info.value.code == "invalid"
    assert smtp.instances == []


async def test_unconfigured_host_is_invalid_without_connecting(smtp):
    with pytest.raises(EmailError) as info:
        await SmtpSender(_settings(smtp_host="")).send(TO, "s", "b", purpose="register")
    assert info.value.code == "invalid"
    assert smtp.instances == []


@pytest.mark.parametrize("raised, code, status", [
    (smtplib.SMTPAuthenticationError(535, b"auth failed for alice.recipient@example.com " + SECRET.encode()), "auth", 535),
    (smtplib.SMTPRecipientsRefused({TO: (550, b"no such user")}), "rejected", 0),
    (smtplib.SMTPDataError(554, b"spam " + TO.encode()), "rejected", 554),
    (smtplib.SMTPSenderRefused(553, b"bad sender", "x@example.test"), "rejected", 553),
    (TimeoutError("timed out"), "timeout", 0),
    (socket.timeout("timed out"), "timeout", 0),
    (ssl.SSLError("bad cert for smtp.example.test"), "tls", 0),
    (ConnectionRefusedError("refused smtp.example.test"), "network", 0),
    (smtplib.SMTPServerDisconnected("gone"), "network", 0),
])
async def test_errors_never_include_password_or_address(smtp, caplog, raised, code, status):
    caplog.set_level(logging.DEBUG, logger="app")
    smtp.plan = {"login": raised} if code == "auth" else {"send_message": raised}
    with pytest.raises(EmailError) as info:
        await SmtpSender(_settings()).send(TO, "s", "b", purpose="register")
    assert info.value.code == code
    assert str(info.value) == code
    assert info.value.status == status
    assert info.value.__cause__ is None and info.value.__suppress_context__
    assert SECRET not in repr(info.value) and TO not in repr(info.value)
    assert SECRET not in caplog.text and TO not in caplog.text and "example.com" not in caplog.text


async def test_connect_errors_map_to_network_or_timeout(smtp):
    smtp.plan = {"connect": ConnectionRefusedError("refused")}
    with pytest.raises(EmailError) as info:
        await SmtpSender(_settings()).send(TO, "s", "b", purpose="register")
    assert (info.value.code, info.value.status) == ("network", 0)
    smtp.plan = {"connect": TimeoutError()}
    with pytest.raises(EmailError) as info:
        await SmtpSender(_settings()).send(TO, "s", "b", purpose="register")
    assert (info.value.code, info.value.status) == ("timeout", 0)


async def test_console_sender_logs_only_sent(caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await ConsoleSender().send(TO, "Subject-SECRET", "Body code 654321", purpose="register")
    assert [r.getMessage() for r in caplog.records if r.name.startswith("app")] == ["email sent purpose=register"]
    for forbidden in (TO, "Subject-SECRET", "654321", "example.com"):
        assert forbidden not in caplog.text


async def test_console_sender_refuses_injection_too():
    with pytest.raises(EmailError) as info:
        await ConsoleSender().send("a@example.com\r\nBcc: x@example.com", "s", "b", purpose="register")
    assert info.value.code == "invalid"


async def test_fake_sender_records_messages():
    fake = FakeSender()
    await fake.send(TO, "Subject", "Body", purpose="reset")
    assert fake.outbox == [(TO, "Subject", "Body")]
    assert fake.purposes == ["reset"]


async def test_fake_sender_can_fail_on_demand():
    fake = FakeSender(fail_with=EmailError("auth", 535))
    with pytest.raises(EmailError):
        await fake.send(TO, "s", "b", purpose="register")
    assert fake.outbox == []


def test_sender_for_picks_by_backend_and_honours_an_override():
    override = FakeSender()
    assert sender_for(_settings(email_backend="off"), override) is override
    assert isinstance(sender_for(_settings(email_backend="smtp")), SmtpSender)
    assert isinstance(sender_for(_settings(email_backend="console")), ConsoleSender)
    assert sender_for(_settings(email_backend="off")) is None


async def test_check_connects_and_logs_in_without_sending(smtp):
    await email_provider.check(_settings())
    conn = smtp.instances[0]
    assert ("login", "noreply@example.test", SECRET) in conn.calls
    assert not any(c[0] == "send_message" for c in conn.calls)
    assert conn.sent == []


async def test_check_reports_auth_failure_by_code_only(smtp):
    smtp.plan = {"login": smtplib.SMTPAuthenticationError(535, b"nope " + SECRET.encode())}
    with pytest.raises(EmailError) as info:
        await email_provider.check(_settings())
    assert (info.value.code, info.value.status) == ("auth", 535)
    assert SECRET not in repr(info.value)


async def test_check_starttls_authenticates_after_starttls(smtp):
    await email_provider.check(_settings(smtp_security="starttls", smtp_port=587))
    names = [c[0] for c in smtp.instances[0].calls]
    assert names.index("starttls") < names.index("login")
