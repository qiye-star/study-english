"""后台发信:模板、失败计数、计量(计划 S15;spec §4.1、R-F6、INDEX X10、X14、X15、X32)。

`Mailer.enqueue` 立即返回:发送在后台任务里进行,所以请求的响应时间不取决于邮箱是否已注册(防枚举)。
服务不读 `app.state`:设置与发送后端的获取方式由构造函数注入(`main.py` 传入 `lambda: app.state.settings` 与
测试覆盖钩子 `app.state.email_sender_override`)。设置在**发送时**读取(热改生效)。

隐私:收件人、验证码、正文只存在于任务的局部变量里;日志只有 `email send failed code=<固定错误码>`;
计量只记 `("email", 后端名, "-", 状态, 耗时)`:SMTP 应答码(如 535)、成功 200、连不上 / 超时 0。
`pending` 是任务集合,`tests/background.py` 靠它等待发送完成。
"""
import asyncio
import logging
from collections.abc import Callable

from app.core import metering
from app.core.config import Settings
from app.providers.email import EmailError, EmailSender, sender_for

logger = logging.getLogger(__name__)

CODE_KINDS = frozenset({"register_code", "reset_code", "bind_code"})
KINDS = CODE_KINDS | {"already_registered", "bind_conflict"}
_PURPOSE = {"register_code": "register", "reset_code": "reset", "bind_code": "bind",
            "already_registered": "notice_registered", "bind_conflict": "notice_bind"}
DEFAULT_LANG = "zh-CN"

# (subject, body). 验证码只出现在正文;`{code}` 只在 CODE_KINDS 的模板里。
_TEMPLATES: dict[str, dict[str, tuple[str, str]]] = {
    "register_code": {
        "zh-CN": ("Enjoy 注册验证码",
                  "你好,\n\n你的 Enjoy 注册验证码是:{code}\n\n验证码 10 分钟内有效,请勿告诉他人。"
                  "如果不是你本人操作,请忽略这封邮件。\n"),
        "en": ("Your Enjoy sign-up code",
               "Hello,\n\nYour Enjoy sign-up code is: {code}\n\nThe code is valid for 10 minutes. Do not share it. "
               "If this was not you, you can ignore this email.\n"),
    },
    "reset_code": {
        "zh-CN": ("Enjoy 找回密码验证码",
                  "你好,\n\n你的 Enjoy 找回密码验证码是:{code}\n\n验证码 10 分钟内有效,请勿告诉他人。"
                  "如果不是你本人操作,请忽略这封邮件,你的密码不会改变。\n"),
        "en": ("Your Enjoy password reset code",
               "Hello,\n\nYour Enjoy password reset code is: {code}\n\nThe code is valid for 10 minutes. Do not share it. "
               "If this was not you, ignore this email: your password will not change.\n"),
    },
    "bind_code": {
        "zh-CN": ("Enjoy 绑定邮箱验证码",
                  "你好,\n\n你的 Enjoy 绑定邮箱验证码是:{code}\n\n验证码 10 分钟内有效,请勿告诉他人。"
                  "如果不是你本人操作,请忽略这封邮件。\n"),
        "en": ("Your Enjoy email verification code",
               "Hello,\n\nYour Enjoy email verification code is: {code}\n\nThe code is valid for 10 minutes. "
               "Do not share it. If this was not you, you can ignore this email.\n"),
    },
    "already_registered": {
        "zh-CN": ("Enjoy:该邮箱已注册",
                  "你好,\n\n这个邮箱已经注册过 Enjoy,可以直接登录;如果忘记了密码,请在登录页使用「找回密码」。"
                  "如果不是你本人操作,请忽略这封邮件。\n"),
        "en": ("Enjoy: this email is already registered",
               "Hello,\n\nThis email address already has an Enjoy account. You can sign in directly, or use "
               "\"Forgot password\" on the sign-in page. If this was not you, you can ignore this email.\n"),
    },
    "bind_conflict": {
        "zh-CN": ("Enjoy:有人尝试绑定你的邮箱",
                  "你好,\n\n有人尝试把这个邮箱绑定到另一个 Enjoy 账号。如果不是你本人操作,可以忽略这封邮件,"
                  "你的账号不受影响。\n"),
        "en": ("Enjoy: someone tried to link your email",
               "Hello,\n\nSomeone tried to link this email address to another Enjoy account. If this was not you, "
               "you can ignore this email: your account is not affected.\n"),
    },
}


def render(kind: str, lang: str, code: str | None) -> tuple[str, str]:
    """`(subject, body)` for a kind; an unknown language falls back to Chinese. Programming errors raise ValueError."""
    if kind not in KINDS:
        raise ValueError("unknown mail kind")
    if kind in CODE_KINDS and not code:
        raise ValueError("this mail kind needs a code")
    templates = _TEMPLATES[kind]
    subject, body = templates.get(lang) or templates[DEFAULT_LANG]
    return subject, body.format(code=code) if kind in CODE_KINDS else body


class Mailer:
    def __init__(self, settings: Callable[[], Settings], override: Callable[[], EmailSender | None] = lambda: None):
        self._settings = settings
        self._override = override
        self.pending: set[asyncio.Task] = set()
        self.failures = 0

    def enqueue(self, kind: str, to: str, *, code: str | None = None, lang: str = DEFAULT_LANG) -> None:
        """Schedule one mail and return immediately (must run inside the event loop)."""
        render(kind, lang, code)  # refuse a bad kind or a missing code before anything is spawned
        task = asyncio.create_task(self._deliver(kind, to, code, lang))
        self.pending.add(task)
        task.add_done_callback(self.pending.discard)

    async def _deliver(self, kind: str, to: str, code: str | None, lang: str) -> None:
        try:
            settings = self._settings()
            sender = sender_for(settings, self._override())
            if sender is None:
                self._failed("off")
                return
            subject, body = render(kind, lang, code)
            backend = "smtp" if settings.email_backend == "smtp" else "console"
            timer = metering.Timer()
            status, failed = 200, None
            try:
                await sender.send(to, subject, body, purpose=_PURPOSE[kind])
            except EmailError as exc:
                status, failed = exc.status, exc.code
            except Exception:  # noqa: BLE001 - never keep the exception text: it may carry the recipient
                status, failed = 0, "error"
            if failed:
                self._failed(failed)
            metering.record("email", backend, "-", status, timer.ms(), unit="calls")
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - a background task must never leak the recipient through a traceback
            self._failed("error")

    def _failed(self, code: str) -> None:
        self.failures += 1
        logger.warning("email send failed code=%s", code)
