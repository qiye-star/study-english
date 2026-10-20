"""ALTCHA v2 适配(spec 2026-10-20-captcha-altcha R-C4、R-C5、R-C18–R-C20;计划 S2 签发、S3 校验)。

只依赖标准库与官方库 `altcha==2.3.0`(core 允许第三方包;不加入 STDLIB_ONLY)。
不记录任何日志;不保存或返回密钥;时间只通过显式的 `now` 整数参数传入。
"""
import hmac
import secrets

import altcha

ALGORITHM = "PBKDF2/SHA-256"  # R-C4:确定性 PBKDF2 挑战
MAX_HEADER_BYTES = 4096  # X-Captcha 头的上限(R-C18)
MAX_TTL_SECONDS = 1800  # 挑战最长有效期
CLOCK_SKEW_SECONDS = 60  # 允许的时钟偏差
HEADER = "x-captcha"  # 请求头名(大小写不敏感)


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
