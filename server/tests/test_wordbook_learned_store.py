"""已学词的数据层(计划 2026-10-12-wordbook-learned-review S2)。"""
from datetime import timedelta

from sqlalchemy import select

from app.models import User, VocabularyItem, utcnow
from app.services.stats import as_utc
from app.wordbook import learned, store

SRC = "wordbook:junior"


async def user_id(app, client) -> int:
    await client.post("/api/users", json={"username": "alice", "password": "password123"})
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(User.id))


def row(uid, word, *, box=0, lapses=0, hours_ago=0.0, source=SRC, due_hours=24.0, reviewed_hours_ago=None):
    now = utcnow()
    return VocabularyItem(id=f"id-{word}", user_id=uid, word=word, meaning="", source=source, box=box, lapses=lapses,
                          due_at=now + timedelta(hours=due_hours), reps=0, created_at=now - timedelta(hours=hours_ago),
                          last_reviewed_at=None if reviewed_hours_ago is None else now - timedelta(hours=reviewed_hours_ago))


async def seed(app, *rows):
    async with app.state.sessionmaker() as s:
        s.add_all(rows)
        await s.commit()


def page(**kw):
    base = dict(tier=None, weak=False, since=None, until=None, prefix=None, after=None, limit=50)
    return {**base, **kw}


async def test_page_is_newest_first_and_cursor_continues(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "old", hours_ago=30), row(uid, "mid", hours_ago=20), row(uid, "new", hours_ago=10))
    async with app.state.sessionmaker() as s:
        first, more = await store.learned_page(s, uid, [SRC], **page(limit=2))
        assert [r.word for r in first] == ["new", "mid"] and more is True
        rest, more = await store.learned_page(s, uid, [SRC], **page(after=(first[-1].created_at, first[-1].id), limit=2))
        assert [r.word for r in rest] == ["old"] and more is False
        assert first[0].book_id == "junior"


async def test_filters_tier_weak_prefix_and_sources(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "ability", box=1, lapses=1), row(uid, "able", box=4), row(uid, "talk", box=2, lapses=2),
               row(uid, "other", source="manual"), row(uid, "abroad", box=3, lapses=1, source="wordbook:senior"))
    async with app.state.sessionmaker() as s:
        async def words(**kw):
            rows, _ = await store.learned_page(s, uid, kw.pop("sources", [SRC]), **page(**kw))
            return sorted(r.word for r in rows)
        assert await words() == ["ability", "able", "talk"]            # 非 wordbook 来源与别的书都不在
        assert await words(tier="mastered") == ["able"]
        assert await words(tier="growing") == ["talk"]
        assert await words(weak=True) == ["ability", "talk"]            # lapses ≥ 1 且 box ≤ 3
        assert await words(prefix="ab") == ["ability", "able"]
        assert await words(prefix="%") == [] and await words(prefix="a_") == []  # 通配符被转义
        assert await words(sources=[SRC, "wordbook:senior"], prefix="abr") == ["abroad"]


async def test_other_users_rows_are_never_listed(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "mine"), row(uid + 1, "theirs"))
    async with app.state.sessionmaker() as s:
        rows, _ = await store.learned_page(s, uid, [SRC], **page())
    assert [r.word for r in rows] == ["mine"]


async def test_counts_group_by_source_and_box(app, client):
    uid = await user_id(app, client)
    now = utcnow()
    await seed(app, row(uid, "a", box=0, hours_ago=1), row(uid, "b", box=2, lapses=1, hours_ago=50),
               row(uid, "c", box=2, source="wordbook:senior", hours_ago=5))
    async with app.state.sessionmaker() as s:
        grouped, weak, y, w = await store.learned_counts(
            s, uid, [SRC, "wordbook:senior"], yesterday=(now - timedelta(hours=60), now - timedelta(hours=40)),
            last7_start=now - timedelta(days=7))
    assert sorted(grouped) == [("wordbook:junior", 0, 1), ("wordbook:junior", 2, 1), ("wordbook:senior", 2, 1)]
    assert (weak, y, w) == (1, 1, 3)


async def test_free_pool_returns_word_and_book(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "a", box=1), row(uid, "b", box=5, source="wordbook:senior"))
    async with app.state.sessionmaker() as s:
        assert sorted(await store.free_pool(s, uid, [SRC, "wordbook:senior"], tier=None, weak=False, since=None, until=None)) \
            == [("a", "junior"), ("b", "senior")]
        assert await store.free_pool(s, uid, [SRC], tier="mastered", weak=False, since=None, until=None) == []


async def test_pull_due_moves_only_a_future_due_date_and_nothing_else(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "later", box=3, due_hours=48), row(uid, "overdue", box=3, due_hours=-5))
    now = utcnow()
    async with app.state.sessionmaker() as s:
        assert await store.pull_due(s, uid, "id-later", now) is True
        assert await store.pull_due(s, uid, "id-overdue", now) is False
        await s.commit()
    async with app.state.sessionmaker() as s:
        later = await s.get(VocabularyItem, "id-later")
        assert as_utc(later.due_at) == now
        assert (later.box, later.reps, later.lapses, later.last_reviewed_at) == (3, 0, 0, None)


async def test_pull_is_blocked_for_24_hours_after_a_real_review(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "fresh", reviewed_hours_ago=2), row(uid, "stale", reviewed_hours_ago=72),
                   row(uid, "never", hours_ago=72), row(uid, "justlearned", hours_ago=0.1),
                   row(uid, "learnedlongago", hours_ago=30, reviewed_hours_ago=None))
    now = utcnow()
    async with app.state.sessionmaker() as s:
        assert await store.pull_eligible(s, uid, "id-fresh", now) is False
        assert await store.pull_eligible(s, uid, "id-stale", now) is True
        assert await store.pull_eligible(s, uid, "id-never", now) is True  # learned 3 days ago, never reviewed
        assert await store.pull_eligible(s, uid, "id-learnedlongago", now) is True
        assert await store.pull_eligible(s, uid, "id-justlearned", now) is False  # learned minutes ago: no pull (R-L6)
        assert await store.pull_eligible(s, uid, "id-missing", now) is False


async def test_free_counters_stop_at_their_daily_maximum(app, client, monkeypatch):
    uid = await user_id(app, client)
    monkeypatch.setattr(store, "FREE_PULLS_DAILY_MAX", 2)
    monkeypatch.setattr(store, "FREE_STARTS_DAILY_MAX", 1)
    async with app.state.sessionmaker() as s:
        assert [await store.consume_free_pull(s, uid, "2026-10-12") for _ in range(3)] == [True, True, False]
        assert [await store.consume_free_start(s, uid, "2026-10-12") for _ in range(2)] == [True, False]
        assert learned.PAGE_MAX == 50  # 常量没被测试改动
