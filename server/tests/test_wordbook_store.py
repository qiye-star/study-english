from datetime import datetime, timedelta, timezone

from app.models import User, VocabularyItem
from app.wordbook import store
from app.wordbook.index import DictionaryStore
from tests.wordbook_helpers import make_data_dir

NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)
UID = 10000007


async def add_user(s):
    s.add(User(id=UID, username="lily", password_hash="x"))
    await s.commit()


async def test_enroll_pauses_others_and_keeps_progress(app):
    async with app.state.sessionmaker() as s:
        await add_user(s)
        a = await store.enroll(s, UID, "cet4", daily_new=20, review_cap=100, order_mode=None, now=NOW, seed=11)
        assert (a.status, a.order_mode, a.seed) == ("active", "shuffle", 11)
        a.cursor = 9
        await s.commit()
        await store.enroll(s, UID, "junior", daily_new=10, review_cap=50, order_mode="book", now=NOW, seed=12)
        again = await store.enroll(s, UID, "cet4", daily_new=None, review_cap=None, order_mode=None, now=NOW, seed=99)
        assert (again.status, again.cursor, again.seed, again.daily_new) == ("active", 9, 11, 20)
        rows = {e.book_id: e.status for e in await store.enrollments(s, UID)}
        assert rows == {"cet4": "active", "junior": "paused"}
        assert (await store.active_enrollment(s, UID)).book_id == "cet4"
        assert (await store.get_enrollment(s, UID, "junior")).status == "paused"
        switched = await store.enroll(s, UID, "cet4", daily_new=None, review_cap=None, order_mode="book", now=NOW, seed=1)
        assert (switched.order_mode, switched.cursor) == ("book", 0)  # 改顺序从头开始(跳过已学)


async def test_enroll_after_a_stale_read_still_leaves_one_active_book(app, monkeypatch):
    """Review m8: a concurrent PUT /enrollment for another book committed after our read."""
    async with app.state.sessionmaker() as s:
        await add_user(s)
        await store.enroll(s, UID, "cet4", daily_new=20, review_cap=100, order_mode=None, now=NOW, seed=1)
    real = store.enrollments

    async def stale(session, user_id):
        return [e for e in await real(session, user_id) if e.book_id != "cet4"]

    monkeypatch.setattr(store, "enrollments", stale)
    async with app.state.sessionmaker() as s:
        await store.enroll(s, UID, "junior", daily_new=20, review_cap=100, order_mode=None, now=NOW, seed=2)
    monkeypatch.setattr(store, "enrollments", real)
    async with app.state.sessionmaker() as s:
        rows = {e.book_id: e.status for e in await store.enrollments(s, UID)}
    assert rows == {"cet4": "paused", "junior": "active"}


async def test_concurrent_first_enrollment_in_the_same_book_is_not_an_error(app, monkeypatch):
    async with app.state.sessionmaker() as s:
        await add_user(s)
        await store.enroll(s, UID, "junior", daily_new=20, review_cap=100, order_mode=None, now=NOW, seed=1)
    real = store.enrollments

    async def nothing_yet(session, user_id):
        return []

    monkeypatch.setattr(store, "enrollments", nothing_yet)
    async with app.state.sessionmaker() as s:
        e = await store.enroll(s, UID, "junior", daily_new=30, review_cap=None, order_mode=None, now=NOW, seed=2)
        assert (e.book_id, e.status, e.seed, e.daily_new) == ("junior", "active", 1, 30)
    monkeypatch.setattr(store, "enrollments", real)


async def test_items_events_counts_and_answer_cap(app, tmp_path, monkeypatch):
    ds = DictionaryStore(make_data_dir(tmp_path))
    card = await ds.card("junior", "talk")
    async with app.state.sessionmaker() as s:
        await add_user(s)
        item_id = await store.create_item(s, UID, "junior", card, box=0, due_at=NOW + timedelta(days=1), now=NOW)
        for kind, word in (("learn", "talk"), ("learn", "talk"), ("review", "talk"), ("practice", "talk")):
            await store.add_event(s, user_id=UID, book_id="junior", kind=kind, word=word, item_id=item_id, qtype="meaning",
                                  outcome="correct", credit=100, day="2026-10-10", now=NOW)
        await s.commit()
        row = await s.get(VocabularyItem, item_id)
        assert (row.source, row.word, row.box) == ("wordbook:junior", "talk", 0)
        assert row.meaning.startswith("v. 说话；谈话") and row.example.startswith("I could hear")
        assert await store.today_counts(s, UID, "junior", "2026-10-10") == (1, 1)
        assert await store.today_counts(s, UID, "junior", "2026-10-11") == (0, 0)
        assert await store.today_learned_keys(s, UID, "junior", "2026-10-10") == ["talk"]
        assert (await store.known_one(s, UID, "talk")).item_id == item_id
        assert set(await store.known_words(s, UID)) == {"talk"}
        monkeypatch.setattr(store, "ANSWERS_DAILY_MAX", 1)
        assert await store.consume_answer(s, UID, "2026-10-10") is True
        assert await store.consume_answer(s, UID, "2026-10-10") is False


async def test_set_cursor_only_moves_forward(app):
    async with app.state.sessionmaker() as s:
        await add_user(s)
        await store.enroll(s, UID, "junior", daily_new=20, review_cap=100, order_mode="book", now=NOW, seed=1)
        await store.set_cursor(s, UID, "junior", 4)
        await store.set_cursor(s, UID, "junior", 2)
        await s.commit()
        assert (await store.get_enrollment(s, UID, "junior")).cursor == 4


async def test_load_hidden_marks_store(app, tmp_path):
    from app.models import WordbookHiddenSentence
    ds = DictionaryStore(make_data_dir(tmp_path))
    async with app.state.sessionmaker() as s:
        s.add(WordbookHiddenSentence(sentence_id="a" * 16, book_id="junior", hidden_by="admin", created_at=NOW))
        await s.commit()
        await store.load_hidden(s, ds)
    assert ds.hidden == frozenset({"a" * 16}) and ds.hidden_loaded
