"""人机验证的错误字符串与守卫(spec 2026-10-20-captcha-altcha §6.4、R-C2、R-C16、R-C17)。

本文件**不是路由**(没有 APIRouter,与 `routers/live_connections.py` 同类,INDEX X30 先例)。
错误文案是固定的英文字符串,定义在这里,测试逐字比较;不拼接任何输入。
"""
from typing import Literal

Scope = Literal["register", "email_code", "reset", "login"]  # R-C17

CAPTCHA_REQUIRED = "captcha_required"  # 428:需要但请求没带(或只带了空白)
CAPTCHA_INVALID = "captcha_invalid"  # 428:带了,但任何一种校验失败(含重放)
CAPTCHA_NOT_CONFIGURED = "Captcha is not configured"  # 503:开着但没有 CAPTCHA_SECRET(失败即关闭)
CAPTCHA_OFF = "Captcha is off"  # 404:只在 GET /api/captcha/challenge,模式为 off 时
