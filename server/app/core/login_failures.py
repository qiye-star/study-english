"""登录失败计数(spec 2026-10-20-captcha-altcha R-C6、R-C8;计划 S7)。

两个 `RateLimiter`:按 IP、按登录名。登录名的键是带进程随机密钥的 blake2b 摘要,计数器里从不出现明文(R-C6)。
进程内,只适用于单 worker:重启清零,多进程时阈值放大为进程数倍(spec §15,已知限制)。
只用于「要不要出人机验证」;不记录日志,不入库。
"""
import hashlib
import secrets
import time
from collections.abc import Callable

from app.core.ratelimit import RateLimiter


class LoginFailures:
    def __init__(self, limit: int, window_seconds: float, clock: Callable[[], float] = time.monotonic):
        self._ip = RateLimiter(limit, window_seconds, clock)
        self._name = RateLimiter(limit, window_seconds, clock)
        self._key = secrets.token_bytes(16)  # per process: a dump of the counters does not reveal login names

    def _name_key(self, name: str) -> str:
        return hashlib.blake2b(name.encode(), key=self._key, digest_size=16).hexdigest()

    def record(self, ip: str, name: str) -> None:
        """记一次失败登录(401)。名字不存在也记:否则「被标记」会变成用户名探测口(R-C8)。"""
        self._ip.allow(ip)
        self._name.allow(self._name_key(name))

    def flagged(self, ip: str, name: str | None) -> bool:
        """同一 IP 或同一登录名在窗口内失败次数已达上限。`name` 为 None 时只看 IP。"""
        if self._ip.exhausted(ip):
            return True
        return name is not None and self._name.exhausted(self._name_key(name))

    def ip_flagged(self, ip: str) -> bool:
        return self._ip.exhausted(ip)

    def reconfigure(self, limit: int, window_seconds: float) -> None:
        """热改:两个计数器的上限与窗口一起改(设置监听调用)。"""
        for limiter in (self._ip, self._name):
            limiter.limit = limit
            limiter.window = window_seconds
