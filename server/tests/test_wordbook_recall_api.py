"""背单词 v2 · 三档自评与快速回忆的端点规则(spec 2026-10-11-wordbook-recall §5、§6)。"""
from datetime import timedelta

from sqlalchemy import select, update

from app.models import User, VocabularyItem, WordbookEnrollment, WordbookEvent, utcnow
from app.wordbook import recall, service
from app.wordbook.entry import meaning_line
from app.wordbook.index import dictionary
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h


async def ans(client, h, **body):
    return await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "tz_offset_minutes": 480, **body})


async def rate(client, h, key, rating, mode="learn", **extra):
    return (await ans(client, h, key=key, mode=mode, qtype="recall", rating=rating, **extra)).json()


async def row(app, word):
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(VocabularyItem).where(VocabularyItem.word == word))


async def events(app):
    async with app.state.sessionmaker() as s:
        return [(e.kind, e.word, e.qtype, e.outcome) for e in
                (await s.scalars(select(WordbookEvent).order_by(WordbookEvent.id))).all()]


async def make_due(app, word):
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == word)
                        .values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()


async def meaning(app, key):
    return meaning_line(await dictionary(app).card("junior", key))


def always_recall(monkeypatch):
    monkeypatch.setattr(service, "use_recall", lambda user_id, key, reps, box: box in (1, 2, 4, 5))


async def test_config_carries_the_learn_preferences(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_autoplay=False)
    cfg = (await client.get(f"{URL}/config", headers=h)).json()
    assert cfg["learn"] == {"autoplay": False, "show_example": True}
