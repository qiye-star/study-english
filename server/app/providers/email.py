"""发信后端(计划 S12;spec §4.2、R-F1、INDEX X14、X22)。

接口不绑定 QQ:`EmailSender.send(to, subject, body, purpose=)` 有三个实现(SMTP / console / 测试用 Fake),
以后换事务邮件服务只需新增实现。纯 I/O:不导入 FastAPI,不读 `app.state`,设置作为参数传入。

隐私硬规则:收件人、主题、正文、SMTP 密码从不进日志、异常信息或返回值。`EmailError` 只带一个固定的错误码
(`auth` / `timeout` / `network` / `tls` / `rejected` / `invalid`)与 SMTP 应答码数字;原始异常被丢弃
(`from None`),因为 smtplib 的异常文本可能含收件人或服务器回显。计量由调用方(`services/mailer`)记录,
只记状态与耗时。
"""
import asyncio
import logging
import re
import smtplib
import ssl
from email.message import EmailMessage
from typing import Protocol

from app.core.config import Settings

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 10
_UNSAFE = re.compile(r"[\r\n\s\x00-\x1f\x7f]")  # header injection: no CR / LF / whitespace / control chars
_PURPOSE = re.compile(r"[a-z_]{1,24}")


class EmailError(Exception):
    """A send or connection check failed. `str()` is the code only; `status` is the SMTP reply code or 0."""

    def __init__(self, code: str, status: int = 0):
        super().__init__(code)
        self.code = code
        self.status = int(status)


class EmailSender(Protocol):
    async def send(self, to: str, subject: str, body: str, *, purpose: str) -> None: ...


def _validate(to: str, subject: str, sender: str | None = None) -> None:
    """Refuse anything that could add or split a header. Raises EmailError("invalid") without echoing the value."""
    if not to or _UNSAFE.search(to) or "\r" in subject or "\n" in subject:
        raise EmailError("invalid")
    if sender is not None and ("\r" in sender or "\n" in sender or not sender.strip()):
        raise EmailError("invalid")


def _map(exc: BaseException) -> EmailError:
    """Reduce any smtplib / socket / ssl failure to a code; the original text is never kept."""
    if isinstance(exc, EmailError):
        return exc
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return EmailError("auth", exc.smtp_code)
    if isinstance(exc, smtplib.SMTPConnectError):
        return EmailError("network", exc.smtp_code)
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return EmailError("rejected")
    if isinstance(exc, smtplib.SMTPResponseException):
        return EmailError("rejected", exc.smtp_code)
    if isinstance(exc, TimeoutError):  # socket.timeout is an alias
        return EmailError("timeout")
    if isinstance(exc, ssl.SSLError):  # before OSError: SSLError is one
        return EmailError("tls")
    return EmailError("network")


class _Session:
    """`with _Session(settings) as smtp:` opens, secures and authenticates one SMTP connection."""

    def __init__(self, settings: Settings):
        self.s = settings
        self.smtp = None

    def __enter__(self):
        s = self.s
        if not s.smtp_host.strip():
            raise EmailError("invalid")
        context = ssl.create_default_context()
        try:
            if s.smtp_security == "ssl":
                smtp = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=TIMEOUT_SECONDS, context=context)
            else:
                smtp = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=TIMEOUT_SECONDS)
            self.smtp = smtp
            smtp.__enter__()
            if s.smtp_security != "ssl":
                smtp.ehlo()
                smtp.starttls(context=context)
                smtp.ehlo()
            if s.smtp_user:
                smtp.login(s.smtp_user, s.smtp_password)
        except BaseException as exc:  # noqa: BLE001 - mapped to a code; the original (possibly sensitive) text is dropped
            self._close()
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            raise _map(exc) from None
        return smtp

    def _close(self):
        if self.smtp is not None:
            try:
                self.smtp.__exit__(None, None, None)
            except Exception:  # noqa: BLE001 - closing must not mask the real failure
                pass
            self.smtp = None

    def __exit__(self, *exc):
        self._close()
        return False


class SmtpSender:
    """Real SMTP; `smtplib` runs in a worker thread (10 s timeout). Reads the settings it was built with."""

    def __init__(self, settings: Settings):
        self.settings = settings

    async def send(self, to: str, subject: str, body: str, *, purpose: str) -> None:
        sender = self.settings.smtp_from or self.settings.smtp_user
        _validate(to, subject, sender)
        message = EmailMessage()
        message["From"] = sender
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body, charset="utf-8")
        try:
            await asyncio.to_thread(self._send_blocking, message)
        except EmailError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise _map(exc) from None

    def _send_blocking(self, message: EmailMessage) -> None:
        with _Session(self.settings) as smtp:
            try:
                smtp.send_message(message)
            except BaseException as exc:  # noqa: BLE001
                if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                    raise
                raise _map(exc) from None


class ConsoleSender:
    """Development backend: logs that a message was sent, never the address, subject or body."""

    async def send(self, to: str, subject: str, body: str, *, purpose: str) -> None:
        _validate(to, subject)
        logger.info("email sent purpose=%s", purpose if _PURPOSE.fullmatch(purpose) else "other")


class FakeSender:
    """Test backend: keeps `(to, subject, body)` in `outbox` and the purposes in `purposes`."""

    def __init__(self, fail_with: EmailError | None = None):
        self.outbox: list[tuple[str, str, str]] = []
        self.purposes: list[str] = []
        self.fail_with = fail_with

    async def send(self, to: str, subject: str, body: str, *, purpose: str) -> None:
        _validate(to, subject)
        if self.fail_with is not None:
            raise self.fail_with
        self.outbox.append((to, subject, body))
        self.purposes.append(purpose)


def sender_for(settings: Settings, override: EmailSender | None = None) -> EmailSender | None:
    """The sender for the current settings, or None when email is off. `override` wins (tests inject a FakeSender)."""
    if override is not None:
        return override
    if settings.email_backend == "smtp":
        return SmtpSender(settings)
    if settings.email_backend == "console":
        return ConsoleSender()
    return None


async def check(settings: Settings) -> None:
    """Connect, secure and authenticate against the SMTP server without sending anything (admin probe, X22).
    Raises EmailError with a code only."""
    def run() -> None:
        with _Session(settings):
            return None

    try:
        await asyncio.to_thread(run)
    except EmailError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _map(exc) from None
