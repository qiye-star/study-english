"""Object key rules shared by every backend (plan 2026-10-21-l1-object-storage, R2).

A key is the existing relative path (`library/<uid>/<id>/media.mp4`), `/`-separated, ASCII only. The first segment
must be one of ROOTS, so no key can ever name the SQLite database file kept beside the blobs.
"""
import re

ROOTS = ("library", "recordings", "room_audio", "avatars", "backups", "bundles")
MAX_KEY_LENGTH = 512

_SEGMENT = re.compile(r"[A-Za-z0-9._-]+")


def _reject(message: str) -> None:
    raise ValueError(f"storage: {message}")


def check_key(key: str) -> str:
    """Return `key` unchanged if it is a legal object key, else raise ValueError (the message never echoes it)."""
    if not isinstance(key, str) or not key or len(key) > MAX_KEY_LENGTH:
        _reject("invalid key")
    if key.startswith("/") or key.endswith("/") or "\\" in key:
        _reject("invalid key")
    parts = key.split("/")
    for part in parts:
        if part in ("", ".", "..") or _SEGMENT.fullmatch(part) is None:
            _reject("invalid key")
    if parts[0] not in ROOTS:
        _reject("key outside the storage roots")
    if parts[0] == "library":
        # staging lives on local disk only; it must never become a persistent object
        if len(parts) > 1 and parts[1] == "_tmp":
            _reject("staging keys are not stored")
        if len(parts) > 2 and parts[1] == "_catalog" and parts[2] == "_tmp":
            _reject("staging keys are not stored")
    return key


def check_prefix(prefix: str) -> str:
    """A listing or delete prefix must end with `/` (so `library/1/` never matches `library/10/`)."""
    if not isinstance(prefix, str) or not prefix.endswith("/"):
        _reject("prefix must end with /")
    body = prefix[:-1]
    if body == "":
        _reject("empty prefix")
    if body in ROOTS:
        return prefix
    check_key(body)
    return prefix


def join(*parts: str) -> str:
    return check_key("/".join(parts))
