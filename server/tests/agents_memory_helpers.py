"""智能体记忆测试工具(计划 A2)。大模型一律用 FakeLLM,不访问上游。"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from types import SimpleNamespace

from app.models import Conversation, Message, utcnow
from tests.links_helpers import check_contract, user_id_of  # noqa: F401  (re-exported for the memory tests)


def enable_agents(app, **overrides) -> None:
    """model_copy 不做校验:测试可以给 agents_history_max 之类的字段设很小的值。"""
    app.state.settings = app.state.settings.model_copy(
        update={"agents_enabled": True, "agents_memory_enabled": True, **overrides})


def user_prefs(**overrides):
    """A1 的 AgentSettings 里本计划读取的字段。"""
    return SimpleNamespace(**{**dict(memory_enabled=True, share_in_rooms=True, tools={"memory": True}), **overrides})


async def add_conversation(app, user_id: int, conversation_id: str = "c1") -> str:
    now = utcnow()
    async with app.state.sessionmaker() as s:
        s.add(Conversation(id=conversation_id, user_id=user_id, name="n", config={}, created_at=now, updated_at=now))
        await s.commit()
    return conversation_id


async def add_messages(app, conversation_id: str, rows: list[tuple[str, str]], start: datetime,
                       step_seconds: int = 60) -> None:
    async with app.state.sessionmaker() as s:
        for i, (role, text) in enumerate(rows):
            s.add(Message(id=f"{conversation_id}-{int(start.timestamp())}-{i}", conversation_id=conversation_id,
                          role=role, content=text, created_at=start + timedelta(seconds=i * step_seconds)))
        await s.commit()


@dataclass
class FakeRecord:
    """A1 的 TurnRecord 里本计划读取的字段(INDEX X2:正文字段叫 text)。"""
    user_id: int
    at: datetime
    text: str | None = "hello"
    tutor_session_id: str | None = None
    persona_id: str = "builtin:coach"
    conversation_id: str | None = "c1"
    room_id: str | None = None
    mode: str = "chat"
    in_room: bool = False


class FakeLLM:
    """按顺序返回预设回复;回复是异常实例时抛出;用完后返回空操作。"""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls: list[list[dict]] = []

    async def __call__(self, messages, max_tokens):
        self.calls.append(messages)
        reply = self.replies.pop(0) if self.replies else '{"ops": []}'
        if isinstance(reply, BaseException):
            raise reply
        return reply


class FakeDeps:
    """extract / summarize 需要的最小依赖(complete + count)。"""

    def __init__(self, *replies):
        self.complete = FakeLLM(*replies)
        self.counters: dict[str, int] = {}

    def count(self, name: str, n: int = 1) -> None:
        self.counters[name] = self.counters.get(name, 0) + n


def ctx(uid: int, *, text: str = "Let's practise IELTS", thread: str | None = "c1", in_room: bool = False,
        persona: str = "builtin:coach", **prefs):
    """A1 的 SourceCtx;persona 只需要 .id,settings 是用户级 AgentSettings 的替身。"""
    from app.agents.context import SourceCtx
    return SourceCtx(user_id=uid, persona=SimpleNamespace(id=persona), settings=user_prefs(**prefs), text=text,
                     thread_id=thread, in_room=in_room)
