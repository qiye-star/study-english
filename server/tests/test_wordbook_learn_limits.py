"""Server-side limits on learning new words (review M1)."""
from sqlalchemy import select

from app.models import VocabularyItem, WordbookEvent, XpEvent
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
NOW_OFFSET = 480


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), rank_enabled=True, **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h


async def ans(client, h, **body):
    return await client.post(f"{URL}/answers", headers=h,
                             json={"book_id": "junior", "tz_offset_minutes": NOW_OFFSET, **body})


async def me(client, h) -> dict:
    r = await client.get("/api/rank/me", headers=h, params={"tz_offset_minutes": NOW_OFFSET})
    assert r.status_code == 200, r.text
    return r.json()


# ---- M1: word_learned is limited server-side ----

async def test_learn_answers_respect_daily_new_on_the_server(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "daily_new": 5})
    for key in ("talk", "ability", "able", "abandon", "absorb"):
        assert (await ans(client, h, key=key, mode="learn", qtype="meaning", known=True)).status_code == 200
    r = await ans(client, h, key="go", mode="learn", qtype="meaning", known=True)
    assert r.status_code == 429 and r.json() == {"error": "Daily new-word limit reached"}
    again = await ans(client, h, key="talk", mode="learn", qtype="meaning", choice="x")
    assert again.status_code == 200  # re-quizzing a word learned today is practice, not a new word
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(VocabularyItem).where(VocabularyItem.word == "go"))) is None


async def test_learn_answers_require_the_active_book(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "cet4")), rank_enabled=True)
    r = await client.post(f"{URL}/answers", headers=h, json={"book_id": "cet4", "key": "talk", "mode": "learn",
                                                            "qtype": "meaning", "known": True})
    assert r.status_code == 409 and r.json() == {"error": "Book is not active"}


async def test_delete_then_relearn_does_not_log_the_word_again(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    for _ in range(3):
        assert (await ans(client, h, key="talk", mode="learn", qtype="meaning", known=True)).status_code == 200
        items = (await client.get("/api/vocabulary", headers=h, params={"scope": "all"})).json()["vocabulary_items"]
        (item,) = [i for i in items if i["word"] == "talk"]
        assert (await client.delete(f"/api/vocabulary/{item['id']}", headers=h)).status_code == 200
    async with app.state.sessionmaker() as s:
        kinds = (await s.scalars(select(WordbookEvent.kind).where(WordbookEvent.word == "talk")
                                 .order_by(WordbookEvent.id))).all()
    assert kinds == ["learn", "relearn", "relearn"]
    today = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": NOW_OFFSET})).json()
    assert today["plan"]["new_done"] == 1
    await me(client, h)  # runs the rank sync
    async with app.state.sessionmaker() as s:
        assert len((await s.scalars(select(XpEvent).where(XpEvent.kind == "word_learned"))).all()) == 1


async def test_words_learned_achievement_counts_distinct_words(app):
    from datetime import datetime, timezone

    from app.models import User
    from app.rank import achievements

    now = datetime(2026, 11, 10, 9, 0, tzinfo=timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add(User(id=10000032, username="d", password_hash="x"))
        for _ in range(3):
            s.add(WordbookEvent(user_id=10000032, book_id="junior", kind="learn", word="talk", item_id=None, qtype=None,
                                outcome="known", credit=100, day="2026-11-10", created_at=now))
        await s.commit()
        snap = await achievements.snapshot(s, 10000032, 0, None)
    assert snap.words_learned == 1
