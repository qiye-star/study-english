"""库内密钥覆盖的加密(Fernet:AES-128-CBC + HMAC-SHA256)。错误信息绝不包含明文或密钥。"""
import hashlib
import hmac

from cryptography.fernet import Fernet, InvalidToken


class SecretBoxError(Exception):
    pass


class SecretBox:
    def __init__(self, key: str):
        try:
            self._fernet = Fernet(key.strip().encode())
        except (ValueError, TypeError):
            raise SecretBoxError("invalid key") from None

    def encrypt(self, plain: str) -> str:
        return self._fernet.encrypt(plain.encode()).decode()

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except (InvalidToken, ValueError, TypeError):
            raise SecretBoxError("cannot decrypt") from None


def box_for(settings) -> SecretBox | None:
    key = (settings.settings_encryption_key or "").strip()
    return SecretBox(key) if key else None


def fingerprint(secret: bytes, value: str) -> str:
    if not value:
        return ""
    return hmac.new(secret, value.encode(), hashlib.sha256).hexdigest()[:8]
