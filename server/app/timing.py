"""耗时日志:只记事件名与数字(设计文档 §3.2)。绝不记录用户文本、转写、回复或密钥。"""
import logging
import re
import time
from collections.abc import Callable

logger = logging.getLogger("app.timing")
_SAFE = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")


def _fmt(value: int | float | str) -> str:
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(round(value))
    return value if _SAFE.fullmatch(value) else "?"


def log_timing(event: str, **fields: int | float | str) -> None:
    parts = " ".join(f"{key}={_fmt(fields[key])}" for key in sorted(fields))
    logger.info("timing event=%s %s", event, parts)


class Stopwatch:
    def __init__(self, clock: Callable[[], float] = time.perf_counter):
        self._clock = clock
        self._start = clock()

    def ms(self) -> int:
        return round((self._clock() - self._start) * 1000)
