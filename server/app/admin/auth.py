"""管理端认证:账号来自环境变量,token 为无状态的 HMAC 签名串(不入库,与用户 token 完全隔离)。"""

import base64
import hashlib
import hmac
import json
import time

from fastapi import HTTPException, Request

TOKEN_TYPE = "admin"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(secret: bytes, body: str) -> str:
    return _b64(hmac.new(secret, body.encode(), hashlib.sha256).digest())


def credentials_match(settings, username: str, password: str) -> bool:
    # 两项都比较完再合并结果,避免通过短路泄露哪一项错了
    user_ok = hmac.compare_digest(username.strip().encode(), settings.admin_username.strip().encode())
    pass_ok = hmac.compare_digest(password.encode(), settings.admin_password.encode())
    return user_ok and pass_ok


def issue_token(secret: bytes, ttl_minutes: int, now: float | None = None) -> tuple[str, int]:
    expires = int((now if now is not None else time.time()) + ttl_minutes * 60)
    body = _b64(json.dumps({"typ": TOKEN_TYPE, "exp": expires}, separators=(",", ":")).encode())
    return f"{body}.{_sign(secret, body)}", expires


def verify_token(secret: bytes, token: str, now: float | None = None) -> bool:
    body, dot, signature = token.partition(".")
    if not dot or not hmac.compare_digest(signature, _sign(secret, body)):
        return False
    try:
        payload = json.loads(_unb64(body))
    except (ValueError, TypeError):
        return False
    if not isinstance(payload, dict) or payload.get("typ") != TOKEN_TYPE:
        return False
    exp = payload.get("exp")
    return isinstance(exp, int) and exp > (now if now is not None else time.time())


def require_enabled(request: Request) -> None:
    if not request.app.state.settings.admin_enabled:
        raise HTTPException(404, "Not Found")


async def admin_required(request: Request) -> None:
    """依赖:管理端已启用且携带有效 admin token;否则 404(未启用)/ 401。"""
    require_enabled(request)
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(401, "Unauthorized")
    if not verify_token(request.app.state.admin_secret, token.strip()):
        raise HTTPException(401, "Unauthorized")
