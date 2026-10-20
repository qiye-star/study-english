"""人机验证的错误字符串与守卫(spec 2026-10-20-captcha-altcha §6.3、§6.4、R-C2、R-C9、R-C14、R-C16、R-C17、R-C22)。

本文件**不是路由**(没有 APIRouter,与 `routers/live_connections.py` 同类,INDEX X30 先例)。
路由在处理函数里显式调用 `enforce()`(R-C9):位置由各端点决定,必须在密码哈希与查库之前。
错误文案是固定的英文字符串,定义在这里,测试逐字比较;不拼接任何输入。
不记录载荷、签名、解答或密钥;成功时只记一行计时数字(`app.timing`)。
"""
import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import captcha
from app.core.captcha_policy import captcha_required
from app.core.timing import log_timing
from app.models import utcnow
from app.services import captcha_replay

Scope = Literal["register", "email_code", "reset", "login"]  # R-C17

CAPTCHA_REQUIRED = "captcha_required"  # 428:需要但请求没带(或只带了空白)
CAPTCHA_INVALID = "captcha_invalid"  # 428:带了,但任何一种校验失败(含重放)
CAPTCHA_NOT_CONFIGURED = "Captcha is not configured"  # 503:开着但没有 CAPTCHA_SECRET(失败即关闭)
CAPTCHA_OFF = "Captcha is off"  # 404:只在 GET /api/captcha/challenge,模式为 off 时


async def enforce(request: Request, session: AsyncSession, scope: Scope, *, flagged: bool = False) -> None:
    """按 spec §6.3 的顺序校验 X-Captcha;任何一步失败即抛 HTTPException,通过则返回 None。

    顺序固定:先看本次是否需要(不需要就忽略头、不校验、不写库);再看密钥(缺失即 503);再看头;
    再校验载荷(只读,不写库);最后才认领并提交。伪造或过期的载荷零写入。
    """
    s = request.app.state.settings
    if not captcha_required(s.captcha_mode, scope, flagged):
        return
    if not s.captcha_secret:
        raise HTTPException(503, CAPTCHA_NOT_CONFIGURED)
    header = request.headers.get(captcha.HEADER)
    if header is None or not header.strip():
        raise HTTPException(428, CAPTCHA_REQUIRED)
    ok = captcha.verify(header, s.captcha_secret, now=int(time.time()))
    if ok is None:
        raise HTTPException(428, CAPTCHA_INVALID)
    claimed = await captcha_replay.claim(
        session, ok.signature, datetime.fromtimestamp(ok.expires_at, timezone.utc), utcnow())
    if not claimed:
        raise HTTPException(428, CAPTCHA_INVALID)  # 已用过(重放)
    await session.commit()  # R-C14 / R-C22:认领即作废,之后端点成功与否都不影响
    log_timing("captcha_verify", scope=scope, solve_ms=ok.solve_ms)
