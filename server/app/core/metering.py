"""上游调用计量(spec §8.1)。本文件此时只有上下文;E1 补全队列、记录与刷写。"""
from contextlib import contextmanager
from contextvars import ContextVar

_user: ContextVar[int | None] = ContextVar("metering_user", default=None)
_feature: ContextVar[str] = ContextVar("metering_feature", default="other")


def bind_user(user_id: int) -> None:
    _user.set(user_id)


def current_user_id() -> int | None:
    return _user.get()


def current_feature() -> str:
    return _feature.get()


@contextmanager
def feature_scope(name: str):
    token = _feature.set(name)
    try:
        yield
    finally:
        _feature.reset(token)
