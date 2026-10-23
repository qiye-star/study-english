"""L4 Task 12: 智能体来源 dormant_words(plan R18):只读、私有、开关关时不开数据库会话。"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.agents.context import SourceCtx, enabled
from app.agents.orchestrator import runtime
from app.models import VocabularyItem

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)
UID = 77777777


def enable(app, on: bool = True) -> None:
    app.state.settings = app.state.settings.model_copy(update={"activation_enabled": on})


def ctx(user_id: int = UID) -> SourceCtx:
    return SourceCtx(user_id=user_id, persona=None, settings=None, text=None, thread_id=None)


async def seed(app) -> None:
    from app.models import User

    async with app.state.sessionmaker() as s:
        s.add(User(id=UID, username="agent", password_hash="x"))
        for word, box in (("talk", 2), ("walk", 3), ("sing", 4), ("low", 0)):
            s.add(VocabularyItem(user_id=UID, word=word, source="wordbook:junior", box=box, due_at=NOW,
                                 created_at=NOW - timedelta(days=40)))
        await s.commit()


async def test_the_source_is_registered_and_private(app):
    source = runtime(app).registry.get("dormant_words")
    assert source is not None and source.private is True


async def test_with_the_switch_on_it_gives_two_or_three_dormant_words(app, monkeypatch):
    enable(app)
    monkeypatch.setattr("app.activation.agent_source.utcnow", lambda: NOW)
    await seed(app)
    source = runtime(app).registry.get("dormant_words")
    result = await source.load(ctx())
    assert result is not None
    assert result.label_key == "agents.step.dormant_words"
    assert result.params["count"] == len(result.params["words"]) and 1 <= result.params["count"] <= 3
    assert set(result.params["words"]) <= {"talk", "walk", "sing"}  # box 0 ("low") is not hinted
    assert result.block and all(w in result.block for w in result.params["words"])


async def test_with_the_switch_off_it_answers_none_and_never_opens_a_session(app):
    enable(app, False)
    opened = []
    real = app.state.sessionmaker

    def counting():
        opened.append(1)
        return real()
    app.state.sessionmaker = counting
    try:
        assert await runtime(app).registry.get("dormant_words").load(ctx()) is None
    finally:
        app.state.sessionmaker = real
    assert opened == []


async def test_the_source_is_gated_by_the_agents_tools_switch_and_room_sharing(app):
    enable(app)
    source = runtime(app).registry.get("dormant_words")
    assert enabled(source, ctx(), "off") is False
    assert enabled(source, ctx(), "prefetch") is True


async def test_loading_is_read_only(app):
    enable(app)
    await seed(app)

    async def count():
        async with app.state.sessionmaker() as s:
            return await s.scalar(select(func.count()).select_from(VocabularyItem))
    before = await count()
    await runtime(app).registry.get("dormant_words").load(ctx())
    assert await count() == before
