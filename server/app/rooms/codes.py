"""6-digit room codes (spec 2026-10-09 §5.1). Pure."""
import re
import secrets
from collections.abc import Callable

CODE_RE = re.compile(r"^[1-9]\d{5}$")
_FULLWIDTH = str.maketrans("０１２３４５６７８９", "0123456789")


def normalize_code(raw: str) -> str | None:
    text = re.sub(r"\s+", "", (raw or "").translate(_FULLWIDTH))
    return text if CODE_RE.match(text) else None


def is_weak(code: str) -> bool:
    return len(set(code)) == 1 or code in "0123456789" or code in "9876543210"


def generate_code(randbelow: Callable[[int], int] = secrets.randbelow) -> str:
    while True:
        code = str(100000 + randbelow(900000))
        if not is_weak(code):
            return code
