"""RFC 6238 TOTP(SHA-1、6 位、30 秒、±1 步),标准库实现;恢复码。验证码与密钥永不写日志/审计。"""
import base64
import binascii
import hashlib
import hmac
import secrets
import struct
from urllib.parse import quote, urlencode

DIGITS, PERIOD, WINDOW = 6, 30, 1
RECOVERY_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"


def generate_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode()


def _key(secret: str) -> bytes:
    clean = secret.strip().replace(" ", "").upper()
    return base64.b32decode(clean + "=" * (-len(clean) % 8))


def code_at(secret: str, step: int) -> str:
    digest = hmac.new(_key(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def verify(secret: str, code: str, now: float, last_step: int | None) -> int | None:
    """The matching time step (±WINDOW), or None. Steps <= last_step are refused (no replay)."""
    code = code.strip().replace(" ", "")
    if len(code) != DIGITS or not code.isdigit():
        return None
    try:
        _key(secret)
    except (binascii.Error, ValueError):
        return None
    current = int(now // PERIOD)
    for step in range(current - WINDOW, current + WINDOW + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(code_at(secret, step), code):
            return step
    return None


def provisioning_uri(secret: str, username: str, issuer: str = "Enjoy Admin") -> str:
    label = quote(f"{issuer}:{username}", safe=":")  # Key URI format: literal ":" between issuer and account
    query = urlencode({"secret": secret, "issuer": issuer, "digits": DIGITS, "period": PERIOD}, quote_via=quote)
    return f"otpauth://totp/{label}?{query}"


def new_recovery_codes(n: int = 8) -> list[str]:
    out: set[str] = set()
    while len(out) < n:
        raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(8))
        out.add(f"{raw[:4]}-{raw[4:]}")
    return sorted(out)


def normalise_recovery_code(code: str) -> str:
    return code.strip().lower().replace(" ", "")
