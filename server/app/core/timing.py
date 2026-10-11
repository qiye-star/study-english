"""耗时日志:只记事件名与数字(设计文档 §3.2)。绝不记录用户文本、转写、回复或密钥。

格式(测量脚本可依赖):一行 `timing event=<event> k=v k=v ...`,键按字母序,值为整数、
`true`/`false` 或 `[A-Za-z0-9_.-]{1,40}` 字符串(其他一律 `?`)。事件:
  stt_chat         ms audio_bytes status        (status = 上游 HTTP 状态,0 = 没有响应)
  stt_volc_stream  ms audio_bytes status        (status 同上:200 = 成功,0 = 失败)
  tts_volcengine   ms chars stream status       (status 200 = 成功,0 = 失败)
  agent_turn       chars ctx_ms mode room src_count src_failed src_skipped status tools total_ms ttft_ms
                   (status = ok / limit / disabled / bad_request / cancelled / llm_<kind>;spec 2026-10-12-agents §6.9)
"""
import logging
import math
import re
import time
from collections.abc import Callable

logger = logging.getLogger("app.timing")
_SAFE = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")


def _fmt(value: int | float | str) -> str:
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(round(value)) if math.isfinite(value) else "?"
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
