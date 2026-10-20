"""人机验证的纯策略:哪个作用域在哪种模式下需要验证(spec 2026-10-20-captcha-altcha §2 R-C1、R-C8、§3)。

只用标准库;不依赖 FastAPI、数据库或设置对象(INDEX X31;tests/test_architecture.py 的 STDLIB_ONLY)。
未知的模式或作用域抛 ValueError:调用方只传 Settings 校验过的值,所以这里出现未知值就是程序错误。
"""
from typing import Literal

Mode = Literal["off", "adaptive", "always"]
Scope = Literal["register", "email_code", "reset", "login"]

MODES: frozenset[str] = frozenset({"off", "adaptive", "always"})
SCOPES: frozenset[str] = frozenset({"register", "email_code", "reset", "login"})
# 注册、发邮箱验证码、找回密码:只要模式不是 off 就必验(spec §3)
ALWAYS_SCOPES: frozenset[str] = frozenset({"register", "email_code", "reset"})


def is_on(mode: str) -> bool:
    """True 表示人机验证开启(adaptive 或 always)。"""
    if mode not in MODES:
        raise ValueError(f"unknown captcha mode: {mode!r}")
    return mode != "off"


def captcha_required(mode: str, scope: str, flagged: bool) -> bool:
    """本次请求是否必须带有效的人机验证载荷。

    - off:从不要求。
    - adaptive:注册 / 发码 / 找回密码必验;登录只在被标记(同一 IP 或登录名连续失败)时必验。
    - always:所有作用域必验,登录也不例外(R-C1,应急档)。
    """
    if not is_on(mode):
        return False
    if scope not in SCOPES:
        raise ValueError(f"unknown captcha scope: {scope!r}")
    if scope in ALWAYS_SCOPES:
        return True
    if mode == "always":
        return True
    return bool(flagged)
