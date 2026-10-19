"""公开发码的编排(计划 S16;INDEX X10、X31、X32;R-F5、R-F6):`POST /api/email/code` 背后的业务。

路由只做 HTTP;这里决定「这次请求写什么行、发什么信」。无论邮箱是否已注册,每次请求都走同样的步骤
(查人 → 冷却 / 每日上限 → 全局额度 → 写一行 → 提交 → 入队后台发信),所以对外的状态码、响应体与耗时一致:

| 用途 | 邮箱状态 | 写入 | 发信 |
|---|---|---|---|
| register | 未注册 | 真码 | `register_code` |
| register | 已注册 | 隐藏码(从不发送) | `already_registered` 通知(占全局额度) |
| reset | 已注册 | 真码 | `reset_code` |
| reset | 未注册 | 隐藏码 | 无(只读检查全局额度,耗尽时同样 503,不占额度) |

reset 与「已注册」通知发到库里存的那个地址(`+tag` 变体只用来查人,F1),绝不发到请求里输入的写法。
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
    recipient = email  # replaced by the STORED address below: only bind / change_email mail the typed one
    if purpose == "register" and user is None:
        code, _ = await verification.issue(session, settings, target, "register", now)
        kind = "register_code"
    elif purpose == "register":
        await verification.hidden_issue(session, settings, target, "register", now)
        if not await verification.claim_global_quota(session, cap, day):  # the notice is a real mail
            raise VerificationError("global_daily")
        kind = "already_registered"
        recipient = await identities.stored_email(session, settings, user.id)
    elif user is not None:
        code, _ = await verification.issue(session, settings, target, "reset", now, user_id=user.id)
        kind = "reset_code"
        recipient = await identities.stored_email(session, settings, user.id)
    else:
        await verification.hidden_issue(session, settings, target, "reset", now)
        if not await verification.global_quota_left(session, cap, day):
            raise VerificationError("global_daily")
    await session.commit()  # the mail goes out only after the row is durable
    if kind is not None and recipient is not None:  # recipient None: the stored copy is unreadable, send nothing
        mailer.enqueue(kind, recipient, code=code, lang=lang)


async def request_bound_code(session: AsyncSession, settings: Settings, mailer: Mailer, user_id: int, email: str,
                             purpose: str, now: datetime, lang: str) -> None:
    """Code for the signed-in user's `bind` / `change_email` (R-F6). `email` is normalised; the caller has checked
    the purpose against the account state and, for a change, the password. An address that ANOTHER account owns gets
    a hidden row and a "someone tried to link your email" notice instead of a code, so the answer is the same.
    Commits; raises VerificationError (cooldown / target_daily / global_daily) with nothing written."""
    if purpose not in ("bind", "change_email"):
        raise ValueError("unsupported purpose")
    target = identities.subject_hmac(settings.identity_pepper, email)
    holder = await identities.find_user_by_email(session, settings, email)
    code = None
    recipient = email  # only the bind_code mail goes to the typed address (the caller proved it); a notice never does
    if holder is None or holder.id == user_id:  # free, or another spelling of the user's own address
        code, _ = await verification.issue(session, settings, target, purpose, now, user_id=user_id)
        kind = "bind_code"
    else:
        await verification.hidden_issue(session, settings, target, purpose, now)
        if not await verification.claim_global_quota(session, settings.email_daily_global,
                                                     now.astimezone(timezone.utc).date()):  # the notice is a real mail
            raise VerificationError("global_daily")
        kind = "bind_conflict"
        recipient = await identities.stored_email(session, settings, holder.id)  # the holder's mailbox, F1 spelling
    await session.commit()  # the mail goes out only after the row is durable
    if recipient is not None:  # None: the stored copy is unreadable, send nothing
        mailer.enqueue(kind, recipient, code=code, lang=lang)
