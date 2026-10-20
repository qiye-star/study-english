"""ALTCHA v2 适配(spec 2026-10-20-captcha-altcha R-C4、R-C5、R-C18–R-C20;计划 S2 签发、S3 校验)。

只依赖标准库与官方库 `altcha==2.3.0`(core 允许第三方包;不加入 STDLIB_ONLY)。
不记录任何日志;不保存或返回密钥;时间只通过显式的 `now` 整数参数传入。
"""
import base64
import hmac
import json
import math
import re
import secrets
from dataclasses import dataclass, field

import altcha

ALGORITHM = "PBKDF2/SHA-256"  # R-C4:确定性 PBKDF2 挑战
MAX_HEADER_BYTES = 4096  # X-Captcha 头的上限(R-C18)
MAX_TTL_SECONDS = 1800  # 挑战最长有效期
CLOCK_SKEW_SECONDS = 60  # 允许的时钟偏差
HEADER = "x-captcha"  # 请求头名(大小写不敏感)
MAX_SOLVE_MS = 600000  # 客户端自报解题时间的夹取上限(计时用)

_SIGNATURE_RE = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True)
class Verified:
    """校验通过的结果。签名不进 repr(它是一次性键,不应出现在日志或异常里)。"""

    signature: str = field(repr=False)
    expires_at: int
    solve_ms: int


def derived_keys(secret: str) -> tuple[str, str]:
    """由 CAPTCHA_SECRET 派生两把 HMAC 密钥(R-C20);原始密钥不直接交给库。"""
    if not secret:
        raise ValueError("captcha secret must not be empty")
    raw = secret.encode()
    hmac_secret = hmac.new(raw, b"altcha:challenge", "sha256").hexdigest()
    hmac_key_secret = hmac.new(raw, b"altcha:key", "sha256").hexdigest()
    return hmac_secret, hmac_key_secret


def pick_counter(counter_max: int, multiplier: int, flagged: bool) -> int:
    """服务端选的 counter(R-C19):随机落在 [counter_max/2, counter_max];被标记时乘倍数,上限 0xFFFFFFFF。"""
    half = counter_max // 2
    base = secrets.randbelow(counter_max - half + 1) + half
    return max(1, min(base * (multiplier if flagged else 1), 0xFFFFFFFF))


def issue(secret: str, *, cost: int, counter: int, ttl: int, now: int) -> dict:
    """签发一个 PBKDF2 确定性挑战,返回可直接 JSON 化的 dict。同步函数:调用方用 asyncio.to_thread。"""
    hmac_secret, hmac_key_secret = derived_keys(secret)
    challenge = altcha.create_challenge(
        ALGORITHM,
        cost,
        counter=counter,
        expires_at=now + ttl,
        hmac_secret=hmac_secret,
        hmac_key_secret=hmac_key_secret,
    )
    return challenge.to_dict()


def verify(header: str | None, secret: str, *, now: int) -> Verified | None:
    """校验 X-Captcha 载荷(spec §6.3 第 4–5 步)。全部通过才返回 Verified,任何失败都返回 None。

    顺序固定;我们自己的检查先于官方库;整个函数体在 try 里,从不抛异常、从不记录日志。
    """
    try:
        return _verify(header, secret, now)
    except Exception:
        return None


def _verify(header: str | None, secret: str, now: int) -> Verified | None:
    if not secret or not isinstance(header, str):
        return None
    text = header.strip()
    if not text:
        return None
    if len(text.encode("utf-8")) > MAX_HEADER_BYTES:
        return None
    raw = base64.b64decode(text, validate=True)  # 严格 base64:非字母表字符(含换行)直接失败
    obj = json.loads(raw)
    if not isinstance(obj, dict):
        return None
    challenge = obj.get("challenge")
    solution = obj.get("solution")
    if not isinstance(challenge, dict) or not isinstance(solution, dict):
        return None
    params = challenge.get("parameters")
    signature = challenge.get("signature")
    if not isinstance(params, dict) or not isinstance(signature, str):
        return None
    if params.get("algorithm") != ALGORITHM:
        return None
    key_signature = params.get("keySignature")
    if not isinstance(key_signature, str) or not key_signature:
        return None  # 只接受我们签发的确定性挑战
    expires = params.get("expiresAt")
    # 库在没有 expiresAt 时会跳过自己的过期检查,所以这里是唯一的保护
    if type(expires) is not int:  # bool 是 int 的子类,要排除
        return None
    if not (now < expires <= now + MAX_TTL_SECONDS + CLOCK_SKEW_SECONDS):
        return None
    if not _SIGNATURE_RE.fullmatch(signature):
        return None
    if not isinstance(solution.get("derivedKey"), str):
        return None

    hmac_secret, hmac_key_secret = derived_keys(secret)
    payload = altcha.Payload.from_dict(obj)
    result = altcha.verify_solution(payload, hmac_secret, hmac_key_secret=hmac_key_secret)
    if result.verified is not True or result.expired:
        return None

    solve_ms = _solve_ms(solution.get("time"))
    return Verified(signature=signature, expires_at=expires, solve_ms=solve_ms)


def _solve_ms(value: object) -> int:
    """客户端自报的 solution.time(组件为毫秒),夹到 0–MAX_SOLVE_MS 的整数。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    number = float(value)
    if not math.isfinite(number):
        return 0
    return int(min(max(number, 0.0), MAX_SOLVE_MS))
