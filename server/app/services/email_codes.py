"""公开发码的编排(计划 S16;INDEX X10、X31、X32;R-F5、R-F6):`POST /api/email/code` 背后的业务。

路由只做 HTTP;这里决定「这次请求写什么行、发什么信」。无论邮箱是否已注册,每次请求都走同样的步骤
(查人 → 冷却 / 每日上限 → 全局额度 → 写一行 → 提交 → 入队后台发信),所以对外的状态码、响应体与耗时一致:

| 用途 | 邮箱状态 | 写入 | 发信 |
|---|---|---|---|
| register | 未注册 | 真码 | `register_code` |
| register | 已注册 | 隐藏码(从不发送) | `already_registered` 通知(占全局额度) |
| reset | 已注册 | 真码 | `reset_code` |
| reset | 未注册 | 隐藏码 | 无(只读检查全局额度,耗尽时同样 503,不占额度) |

会话、设置、发信器与时钟都由调用方传入,本模块不读 `app.state`,不记录日志。
"""
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.services import identities, verification
from app.services.mailer import Mailer
from app.services.verification import VerificationError


async def request_code(session: AsyncSession, settings: Settings, mailer: Mailer, email: str, purpose: str,
                       now: datetime, lang: str) -> None:
    """Write the code row for a public request and queue the mail. `email` is already normalised. Commits.
    Raises VerificationError (cooldown / target_daily / global_daily); nothing is written then."""
    if purpose not in ("register", "reset"):
        raise ValueError("unsupported purpose")
    target = identities.subject_hmac(settings.identity_pepper, email)
    user = await identities.find_user_by_email(session, settings, email)
    cap, day = settings.email_daily_global, now.astimezone(timezone.utc).date()
    code = kind = None
    if purpose == "register" and user is None:
        code, _ = await verification.issue(session, settings, target, "register", now)
        kind = "register_code"
    elif purpose == "register":
        await verification.hidden_issue(session, settings, target, "register", now)
        if not await verification.claim_global_quota(session, cap, day):  # the notice is a real mail
            raise VerificationError("global_daily")
        kind = "already_registered"
    elif user is not None:
        code, _ = await verification.issue(session, settings, target, "reset", now, user_id=user.id)
        kind = "reset_code"
    else:
        await verification.hidden_issue(session, settings, target, "reset", now)
        if not await verification.global_quota_left(session, cap, day):
            raise VerificationError("global_daily")
    await session.commit()  # the mail goes out only after the row is durable
    if kind is not None:
        mailer.enqueue(kind, email, code=code, lang=lang)
