"""单词拼写出题 POST /api/wordbook/word-spell/start(计划 2026-10-27 W1,R-W3 / R-W4)。"""
import logging
import re

from sqlalchemy import select

from app.models import VocabularyItem
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
OFFSET = 480
WORDS = ("talk", "ability", "able", "abandon", "absorb", "accept")


async def login(app, client, tmp_path, *, learn: bool = True):
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="junior,senior")
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    if learn:
        for key in WORDS:
            await client.post(f"{URL}/answers", headers=h, json={
                "book_id": "junior", "key": key, "mode": "learn", "qtype": "recall", "rating": "know",
                "tz_offset_minutes": OFFSET})
    return h


async def start(client, h, **body):
    return await client.post(f"{URL}/word-spell/start", headers=h, json={"tz_offset_minutes": OFFSET, **body})


async def box_of(app, word: str) -> int:
    async with app.state.sessionmaker() as s:
        return (await s.scalars(select(VocabularyItem.box).where(VocabularyItem.word == word))).first()


async def test_no_active_book_is_refused(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="junior,senior")
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await start(client, h)).json() == {"error": "No active book"}


async def test_empty_pool_is_refused(app, client, tmp_path):
    h = await login(app, client, tmp_path, learn=False)
    assert (await start(client, h)).json() == {"error": "No words to review"}


async def test_items_are_spell_questions_from_the_learned_pool(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = await start(client, h)
    assert r.status_code == 200
    out = r.json()
    assert set(out) == {"set_id", "book_id", "items"} and out["book_id"] == "junior"
    assert len(out["items"]) == len(WORDS)
    for item in out["items"]:
        q, card = item["question"], item["card"]
        assert item["book_id"] == "junior" and card["key"] in WORDS and " " not in card["key"]
        assert q["qtype"] == "spell" and q["key"] == card["key"]
        assert q["length"] == len(card["word"])


async def test_count_only_accepts_ten_or_twenty(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await start(client, h, count=5)).status_code == 422
    assert (await start(client, h, count=20)).status_code == 200
    assert len((await start(client, h, count=10)).json()["items"]) == len(WORDS)


async def test_manual_vocabulary_with_the_same_word_is_not_in_the_pool(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await client.post("/api/vocabulary", headers=h, json={"word": "monday", "source": "manual"})
    keys = {i["card"]["key"] for i in (await start(client, h, count=20)).json()["items"]}
    assert "monday" not in keys and keys <= set(WORDS)


async def test_answering_a_started_item_through_free_mode_leaves_the_box_alone(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    item = (await start(client, h)).json()["items"][0]
    word = item["card"]["word"]
    before = await box_of(app, item["card"]["key"])
    for qtype in ("dictation", "spell"):
        r = await client.post(f"{URL}/answers", headers=h, json={
            "book_id": "junior", "key": item["card"]["key"], "mode": "free", "qtype": qtype,
            "typed": word, "hinted": False, "tz_offset_minutes": OFFSET})
        assert r.status_code == 200 and r.json()["correct"] is True
    assert await box_of(app, item["card"]["key"]) == before


async def test_logs_carry_no_word_text(app, client, tmp_path, caplog):
    h = await login(app, client, tmp_path)
    caplog.set_level(logging.DEBUG)
    out = (await start(client, h)).json()
    assert out["items"]
    app_text = "\n".join(r.getMessage() for r in caplog.records if r.name == "app" or r.name.startswith("app."))
    for word in WORDS:
        assert not re.search(rf"\b{re.escape(word)}\b", app_text)
