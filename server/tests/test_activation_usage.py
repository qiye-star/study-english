"""L4 Task 6/7: 使用记录处理器(plan R6、R7、R9)。主动使用只改 word_usage;调度列逐列不变。"""
import asyncio
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.core.learning_events import AssessmentFinished, MessageSent, RealtimeTurnFinished, WeakWord
from app.models import User, VocabularyItem, WordUsage

AT = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)
UID = 33333333
OTHER = 33333334


def enable(app, on: bool = True) -> None:
    app.state.settings = app.state.settings.model_copy(update={"activation_enabled": on})


async def drain(app) -> int:
    return await app.state.learning_bus.drain()


async def seed_user(app, uid: int = UID, learned=("talk", "go")):
    async with app.state.sessionmaker() as s:
        s.add(User(id=uid, username=f"u{uid}", password_hash="x"))
        for word in learned:
            s.add(VocabularyItem(user_id=uid, word=word, source="wordbook:junior", box=0, due_at=AT, created_at=AT))
        await s.commit()


async def usage_rows(app, uid: int = UID) -> dict[str, WordUsage]:
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(WordUsage).where(WordUsage.user_id == uid))).all()
        return {r.lemma: r for r in rows}


def chat(text: str, conv: str = "c1", uid: int = UID, msg: str = "m1") -> MessageSent:
    return MessageSent(user_id=uid, conversation_id=conv, message_id=msg, text=text, at=AT)


async def test_chat_counts_learned_words_and_sessions(app):
    enable(app)
    await seed_user(app)
    app.state.learning_bus.publish(chat("I went there and talked"))
    await drain(app)
    rows = await usage_rows(app)
    assert set(rows) == {"go", "talk"}
    assert (rows["talk"].use_count, rows["talk"].session_count, rows["talk"].sources) == (1, 1, "chat")


async def test_same_session_adds_uses_new_session_adds_sessions(app):
    enable(app)
    await seed_user(app)
    app.state.learning_bus.publish(chat("we talked", conv="c1", msg="m1"))
    app.state.learning_bus.publish(chat("we talked again", conv="c1", msg="m2"))
    await drain(app)
    row = (await usage_rows(app))["talk"]
    assert (row.use_count, row.session_count) == (2, 1)
    app.state.learning_bus.publish(chat("talked", conv="c2", msg="m3"))
    await drain(app)
    row = (await usage_rows(app))["talk"]
    assert (row.use_count, row.session_count) == (3, 2)


async def test_unlearned_and_manually_added_words_get_no_row(app):
    enable(app)
    await seed_user(app, learned=("talk",))
    async with app.state.sessionmaker() as s:
        s.add(VocabularyItem(user_id=UID, word="zygomorphic", source="manual", box=0, due_at=AT, created_at=AT))
        await s.commit()
    app.state.learning_bus.publish(chat("a zygomorphic flower and talk"))
    await drain(app)
    assert set(await usage_rows(app)) == {"talk"}


async def test_realtime_turns_count_with_realtime_as_source(app):
    enable(app)
    await seed_user(app, learned=("talk",))
    app.state.learning_bus.publish(RealtimeTurnFinished(user_id=UID, conversation_id="rt1", message_id="m1",
                                                         text="we talked", at=AT))
    await drain(app)
    row = (await usage_rows(app))["talk"]
    assert (row.use_count, row.session_count, row.sources) == (1, 1, "realtime")


async def test_practice_shadowing_only_adds_shadow_counts(app):
    enable(app)
    await seed_user(app, learned=("talk", "three"))
    app.state.learning_bus.publish(AssessmentFinished(
        user_id=UID, assessment_id="a1", source="practice", score=80, good_words=("talk",),
        weak_words=(WeakWord("three", 40),), at=AT))
    await drain(app)
    rows = await usage_rows(app)
    assert (rows["talk"].shadow_count, rows["talk"].use_count, rows["talk"].session_count) == (1, 0, 0)
    assert rows["three"].shadow_count == 1 and rows["three"].use_count == 0


async def test_chat_source_assessments_are_ignored(app):
    enable(app)
    await seed_user(app, learned=("talk",))
    app.state.learning_bus.publish(AssessmentFinished(
        user_id=UID, assessment_id="a2", source="chat", score=80, good_words=("talk",), weak_words=(), at=AT))
    await drain(app)
    assert await usage_rows(app) == {}


async def test_handling_never_changes_the_scheduling_columns(app):
    enable(app)
    await seed_user(app)

    async def snapshot():
        async with app.state.sessionmaker() as s:
            rows = (await s.scalars(select(VocabularyItem).where(VocabularyItem.user_id == UID))).all()
            return sorted((r.id, r.word, r.box, r.due_at, r.reps, r.lapses, r.last_reviewed_at, r.stability,
                           r.difficulty, r.fsrs_state, r.last_review) for r in rows)
    before = await snapshot()
    app.state.learning_bus.publish(chat("talk and go"))
    app.state.learning_bus.publish(AssessmentFinished(
        user_id=UID, assessment_id="a3", source="practice", score=80, good_words=("go",), weak_words=(), at=AT))
    await drain(app)
    assert await snapshot() == before


async def test_switch_off_means_no_work_and_no_rows(app):
    enable(app, False)
    await seed_user(app)
    assert app.state.learning_bus.publish(chat("we talked")) is False
    await drain(app)
    assert await usage_rows(app) == {}


async def test_two_events_for_one_new_word_end_with_the_right_count(app):
    enable(app)
    await seed_user(app, learned=("talk",))
    app.state.learning_bus.publish(chat("talk", conv="c1", msg="m1"))
    app.state.learning_bus.publish(chat("talked", conv="c2", msg="m2"))
    await drain(app)
    row = (await usage_rows(app))["talk"]
    assert (row.use_count, row.session_count) == (2, 2)
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(WordUsage).where(WordUsage.user_id == UID)) == 1


async def test_a_concurrent_first_insert_is_retried_once(app):
    """Two handlers insert the same new word at once: the loser's IntegrityError is retried as an update."""
    from app.activation.usage import handle_chat

    enable(app)
    await seed_user(app, learned=("talk",))
    first, second = chat("talk", conv="c1", msg="m1"), chat("talk", conv="c2", msg="m2")
    await asyncio.gather(handle_chat(app, first), handle_chat(app, second))
    row = (await usage_rows(app))["talk"]
    assert (row.use_count, row.session_count) == (2, 2)


async def test_a_saved_realtime_turn_reaches_word_usage_through_the_bus(app, client, auth_headers):
    """End to end (L4 Task 7): DbMessageStore saves the user turn, publishes after commit, the bus handler counts it."""
    from app.realtime.realtime_providers import DbMessageStore
    from tests.test_realtime_providers import new_conversation, user_id

    enable(app)
    cid = await new_conversation(client, auth_headers)
    uid = await user_id(client, auth_headers)
    async with app.state.sessionmaker() as s:  # the registered user exists already: only their learned word
        s.add(VocabularyItem(user_id=uid, word="talk", source="wordbook:junior", box=0, due_at=AT, created_at=AT))
        await s.commit()
    store = DbMessageStore(app.state.sessionmaker, uid, cid, max_messages=10, publish=app.state.learning_bus.publish)
    await store.add_user("we talked a lot")
    await drain(app)
    row = (await usage_rows(app, uid))["talk"]
    assert (row.use_count, row.session_count, row.sources) == (1, 1, "realtime")
