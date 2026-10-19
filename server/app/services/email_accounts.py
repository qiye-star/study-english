"""邮箱账号流程:邮箱注册(计划 S17;后续任务在此追加找回密码、绑定 / 换绑;INDEX X31、X32;R-F3、R-F6、R-F7、R-F9)。

路由只做 HTTP;这里是「验证码 + 它解锁的写入」。会话、会话工厂、设置与时钟都由调用方传入,本模块不读 `app.state`、
不记录日志、不提交之外的任何东西(提交点写在各函数的文档里)。

所有「码不对」的情形都是同一个 `VerificationError("invalid")`:没有码 / 过期 / 次数用完 / 别的用途或目标 / 不匹配,
以及码对但邮箱已被别的账号占用(唯一约束兜底)。调用方把它映射成同一个 400,所以状态码、响应体都不泄露邮箱是否已注册。
验证码只在**调用方的事务里**被消费:之后任何一步失败并回滚,码仍可再用(失败的猜测次数已提交,见 verification.verify)。
码有效、但失败的原因不是码本身(用户名占用、邀请码被拒、随机用户 id 撞车)时,调用方回滚后用
`verification.release_attempt` 把这次认领还回去;邮箱被占用的情形仍像错误码一样计数。
意外异常发生在码有效之后,则这一次尝试仍计入(见 verification 模块文档)。
"""
from collections.abc import Callable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import User
from app.services import identities, invites, verification
from app.services.verification import VerificationError

INVALID_CODE = "Invalid or expired code"
_ID_ATTEMPTS = 5


class UsernameTaken(Exception):
    pass


class InviteRejected(Exception):
    """`reason` is "invalid" or "used_up" (the `invites.RedeemError` reasons; the router maps them to two messages)."""

    def __init__(self, reason: str = "invalid"):
        super().__init__(reason)
        self.reason = reason


class IdAllocationFailed(Exception):
    pass


def _invalid() -> VerificationError:
    return VerificationError("invalid")


async def register_with_email(
    session: AsyncSession, settings: Settings, *, username: str, password_hash: str,
    nickname: str, email: str, code: str, invite_code: str | None, new_user_id: Callable[[], int], now: datetime,
    user_cap: invites.UserCap,
) -> tuple[User, str]:
    """R-F7: verify the code -> take the invite use (`invite_code=None` = no invite needed) -> new user + email
    identity + verified flag + code consumed + one login token, in ONE commit. Returns `(user, token)`.
    Raises VerificationError("invalid"), InviteRejected, UsernameTaken or IdAllocationFailed; a failure rolls the
    session back, so the code and the invite use are untouched. The attempt is given back for the failures that
    are not about the code (InviteRejected, UsernameTaken, a random id collision); EmailTaken answers like a wrong code."""
    target = identities.subject_hmac(settings.identity_pepper, email)
    for _ in range(_ID_ATTEMPTS):
        row_id = (await verification.verify(session, settings, target, "register", code, now)).id
        code_row = None
        if invite_code is not None:
            try:
                code_row = await invites.redeem(session, invite_code, now, user_cap=user_cap)
            except invites.RedeemError as e:
                await session.rollback()
                await verification.release_attempt(session, row_id)
                raise InviteRejected(e.reason) from None
        user = User(id=new_user_id(), username=username, password_hash=password_hash, nickname=nickname)
        session.add(user)
        try:
            await identities.bind_email(session, settings, user, email, now)
            if code_row is not None:  # who invited whom: the same transaction as the user (invites v2 R-I4)
                invites.record_redemption(session, code_row, user.id, now)
            token = identities.issue_token(session, user.id, settings, now)
            await session.commit()
            return user, token
        except identities.EmailTaken:
            await session.rollback()
            raise _invalid() from None
        except IntegrityError:
            await session.rollback()
            if (await session.execute(select(User.id).where(User.username == username))).first() is not None:
                await verification.release_attempt(session, row_id)
                raise UsernameTaken() from None
            if await identities.find_user_by_email(session, settings, email) is not None:
                raise _invalid() from None  # lost the race for the address: indistinguishable from a wrong code
            await verification.release_attempt(session, row_id)  # otherwise a random user id collided: try again
    raise IdAllocationFailed()


async def reset_password(session: AsyncSession, settings: Settings, *, email: str,
                         code: str, password_hash: str, now: datetime) -> int:
    """S19: verify a `reset` code issued to the address's CURRENT owner, set the new hash and drop every login token
    (`identities.revoke_sessions`), in one commit with the consumed code. Returns the user id so the caller can cut
    the live connections. Raises VerificationError("invalid") for every failure, including an address nobody owns."""
    target = identities.subject_hmac(settings.identity_pepper, email)
    row = await verification.verify(session, settings, target, "reset", code, now)
    user = await identities.find_user_by_email(session, settings, email)
    if user is None or row.user_id != user.id:  # the code was issued to someone else (the address changed hands)
        await session.rollback()
        raise _invalid()
    user.password_hash = password_hash
    await identities.revoke_sessions(session, user.id)
    await session.commit()
    return user.id


async def bind_with_code(session: AsyncSession, settings: Settings, user: User, *,
                         email: str, code: str, purpose: str, now: datetime) -> None:
    """S20: verify a `bind` / `change_email` code issued to THIS user and attach the address (replacing the old
    one), in one commit with the consumed code. Raises VerificationError("invalid") for every failure, also when
    another account owns the address (R-F6: the hidden rows carry no user, so they can never be redeemed)."""
    if purpose not in ("bind", "change_email"):
        raise ValueError("unsupported purpose")
    target = identities.subject_hmac(settings.identity_pepper, email)
    row = await verification.verify(session, settings, target, purpose, code, now)
    if row.user_id != user.id:
        await session.rollback()
        raise _invalid()
    try:
        await identities.bind_email(session, settings, user, email, now)
        await session.commit()
    except (identities.EmailTaken, IntegrityError):
        await session.rollback()
        raise _invalid() from None
