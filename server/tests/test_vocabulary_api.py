import asyncio
from datetime import datetime, timedelta

import pytest
from sqlalchemy import update

from app.models import VocabularyItem, utcnow
import app.routers.vocabulary as vocab_router
from app.routers.vocabulary import apply_review

URL = "/api/vocabulary"
TICK = 0.02  # Windows 时钟精度约 15 ms
KEYS = {"id", "word", "meaning", "example", "source", "box", "due_at", "reps", "lapses", "last_reviewed_at", "created_at"}
NOT_FOUND = {"error": "Vocabulary item not found"}
NOT_DUE = {"error": "Vocabulary item is not due"}
REVIEWED = {"error": "Vocabulary item was already reviewed"}


async def register(client, username):
    r = await client.post("/api/users", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def add(client, headers, word, **extra):
    return await client.post(URL, headers=headers, json={"word": word, **extra})


async def review(client, headers, item_id, grade):
    return await client.post(f"{URL}/{item_id}/review", headers=headers, json={"grade": grade})


async def set_due(app, item_id, when):
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.id == item_id).values(due_at=when))
        await s.commit()


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value)


@pytest.mark.parametrize("method,path", [("GET", URL), ("POST", URL), ("DELETE", f"{URL}/x"), ("POST", f"{URL}/x/review")])
async def test_requires_login(client, method, path):
    assert (await client.request(method, path, json={"word": "x", "grade": "good"})).status_code == 401


async def test_create_normalizes_and_is_due_immediately(client, auth_headers):
    r = await add(client, auth_headers, "  Look  UP ", meaning=" 查找 ", example=" Look it up. ", source="lookup")
    assert r.status_code == 200, r.text
    item = r.json()
    assert set(item) == KEYS
    assert (item["word"], item["meaning"], item["example"], item["source"]) == ("look up", "查找", "Look it up.", "lookup")
    assert (item["box"], item["reps"], item["lapses"], item["last_reviewed_at"]) == (0, 0, 0, None)
    assert item["due_at"] == item["created_at"] and item["created_at"].endswith("+00:00")
    bare = (await add(client, auth_headers, "serendipity", example="   ")).json()
    assert (bare["meaning"], bare["example"], bare["source"]) == ("", None, "manual")


async def test_same_word_returns_the_existing_item(client, auth_headers):
    first = (await add(client, auth_headers, "Apple", meaning="苹果")).json()
    again = await add(client, auth_headers, " apple ", meaning="other", source="recap")
    assert again.status_code == 200 and again.json() == first
    assert len((await client.get(URL, headers=auth_headers)).json()["vocabulary_items"]) == 1


@pytest.mark.parametrize("body", [
    {"word": ""}, {"word": "   "}, {"word": "a" * 101}, {"word": "a" * 201},
    {"word": "ok", "meaning": "m" * 1001}, {"word": "ok", "example": "e" * 501},
    {"word": "ok", "source": "chat"}, {},
])
async def test_validation(client, auth_headers, body):
    assert (await client.post(URL, headers=auth_headers, json=body)).status_code == 422


async def test_list_is_newest_first_and_paginated(client, auth_headers):
    for word in ("one", "two", "three"):
        await add(client, auth_headers, word)
        await asyncio.sleep(TICK)
    first = (await client.get(URL, headers=auth_headers, params={"per_page": 2})).json()
    assert [i["word"] for i in first["vocabulary_items"]] == ["three", "two"]
    assert (first["page"], first["next"], first["due_count"]) == (1, 2, 3)
    second = (await client.get(URL, headers=auth_headers, params={"per_page": 2, "page": 2})).json()
    assert [i["word"] for i in second["vocabulary_items"]] == ["one"] and second["next"] is None
    assert (await client.get(URL, headers=auth_headers, params={"per_page": 51})).status_code == 422


async def test_due_filter_orders_by_due_date_and_counts(app, client, auth_headers):
    a = (await add(client, auth_headers, "alpha")).json()
    b = (await add(client, auth_headers, "beta")).json()
    c = (await add(client, auth_headers, "gamma")).json()
    await set_due(app, a["id"], utcnow() - timedelta(days=2))
    await set_due(app, b["id"], utcnow() + timedelta(days=3))
    await set_due(app, c["id"], utcnow() - timedelta(hours=1))
    due = (await client.get(URL, headers=auth_headers, params={"due": "true"})).json()
    assert [i["word"] for i in due["vocabulary_items"]] == ["alpha", "gamma"]
    assert due["due_count"] == 2
    everything = (await client.get(URL, headers=auth_headers)).json()
    assert len(everything["vocabulary_items"]) == 3 and everything["due_count"] == 2


@pytest.mark.parametrize("settings_overrides", [{"max_vocab_items": 2}], indirect=True)
async def test_limit_is_per_user_and_dedupe_still_works_when_full(client, auth_headers):
    a = (await add(client, auth_headers, "one")).json()
    await add(client, auth_headers, "two")
    r = await add(client, auth_headers, "three")
    assert r.status_code == 429 and r.json() == {"error": "Vocabulary limit reached"}
    assert (await add(client, auth_headers, "ONE")).json() == a
    bob = await register(client, "bob")
    assert (await add(client, bob, "three")).status_code == 200


async def test_isolation(client, auth_headers):
    item = (await add(client, auth_headers, "private")).json()
    bob = await register(client, "bob")
    assert (await client.get(URL, headers=bob)).json()["vocabulary_items"] == []
    r = await client.delete(f"{URL}/{item['id']}", headers=bob)
    assert r.status_code == 404 and r.json() == NOT_FOUND
    r = await review(client, bob, item["id"], "good")
    assert r.status_code == 404 and r.json() == NOT_FOUND
    assert (await add(client, bob, "private")).json()["id"] != item["id"]


async def test_delete(client, auth_headers):
    item = (await add(client, auth_headers, "gone")).json()
    r = await client.delete(f"{URL}/{item['id']}", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"id": item["id"]}
    r = await client.delete(f"{URL}/{item['id']}", headers=auth_headers)
    assert r.status_code == 404 and r.json() == NOT_FOUND


async def test_good_review_advances_and_an_immediate_second_review_is_rejected(client, auth_headers):
    item = (await add(client, auth_headers, "apple")).json()
    r = await review(client, auth_headers, item["id"], "good")
    assert r.status_code == 200, r.text
    done = r.json()
    assert (done["box"], done["reps"], done["lapses"]) == (1, 1, 0)
    assert ts(done["due_at"]) - ts(done["last_reviewed_at"]) == timedelta(days=2)
    r = await review(client, auth_headers, item["id"], "good")
    assert r.status_code == 409 and r.json() == NOT_DUE


async def test_forgot_then_hard(app, client, auth_headers):
    item = (await add(client, auth_headers, "apple")).json()
    await review(client, auth_headers, item["id"], "good")
    await set_due(app, item["id"], utcnow() - timedelta(minutes=1))
    forgot = (await review(client, auth_headers, item["id"], "forgot")).json()
    assert (forgot["box"], forgot["reps"], forgot["lapses"]) == (0, 2, 1)
    assert ts(forgot["due_at"]) - ts(forgot["last_reviewed_at"]) == timedelta(days=1)
    await set_due(app, item["id"], utcnow() - timedelta(minutes=1))
    hard = (await review(client, auth_headers, item["id"], "hard")).json()
    assert (hard["box"], hard["reps"], hard["lapses"]) == (0, 3, 1)
    assert ts(hard["due_at"]) - ts(hard["last_reviewed_at"]) == timedelta(hours=12)


async def test_a_concurrent_stale_review_is_not_applied(app, client, auth_headers):
    """模拟两个并发请求:第二个读到的是 reps=0 的旧快照,在第一个提交之后才写(内存 SQLite 共用一个连接,
    不能用 asyncio.gather 真并发,所以直接调用写入函数)。"""
    item = (await add(client, auth_headers, "apple")).json()
    assert (await review(client, auth_headers, item["id"], "good")).status_code == 200
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    async with app.state.sessionmaker() as s:
        applied = await apply_review(s, uid, item["id"], seen_box=0, seen_reps=0, grade="good", now=utcnow())
        await s.commit()
    assert applied is False
    stored = (await client.get(URL, headers=auth_headers)).json()["vocabulary_items"][0]
    assert (stored["reps"], stored["box"]) == (1, 1)


@pytest.mark.parametrize("body", [{"grade": "easy"}, {}, {"grade": "good", "box": 5}])
async def test_review_validation(client, auth_headers, body):
    item = (await add(client, auth_headers, "apple")).json()
    assert (await client.post(f"{URL}/{item['id']}/review", headers=auth_headers, json=body)).status_code == 422


async def test_deleting_a_conversation_keeps_the_vocabulary(client, auth_headers):
    conv = (await client.post("/api/conversations", headers=auth_headers, json={})).json()
    await add(client, auth_headers, "keep")
    assert (await client.delete(f"/api/conversations/{conv['id']}", headers=auth_headers)).status_code == 200
    assert [i["word"] for i in (await client.get(URL, headers=auth_headers)).json()["vocabulary_items"]] == ["keep"]


async def test_typographic_variants_are_the_same_word(client, auth_headers):
    first = (await add(client, auth_headers, "don't")).json()
    again = await add(client, auth_headers, "  Don\u2019t ")
    assert again.status_code == 200 and again.json() == first


@pytest.mark.parametrize("word", ["bad\x00word", "bad\x07word", "\u200b\u200b"])
async def test_control_and_invisible_only_words_are_rejected(client, auth_headers, word):
    assert (await client.post(URL, headers=auth_headers, json={"word": word})).status_code == 422


async def test_review_of_a_missing_item_is_404(client, auth_headers):
    r = await review(client, auth_headers, "does-not-exist", "good")
    assert r.status_code == 404 and r.json() == NOT_FOUND


async def test_review_before_due_is_409_and_changes_nothing(app, client, auth_headers):
    item = (await add(client, auth_headers, "apple")).json()
    await set_due(app, item["id"], utcnow() + timedelta(days=1))
    r = await review(client, auth_headers, item["id"], "good")
    assert r.status_code == 409 and r.json() == NOT_DUE
    stored = (await client.get(URL, headers=auth_headers)).json()["vocabulary_items"][0]
    assert (stored["reps"], stored["box"], stored["last_reviewed_at"]) == (0, 0, None)


async def test_route_stale_guard_returns_already_reviewed_and_rolls_back(app, client, auth_headers, monkeypatch):
    item = (await add(client, auth_headers, "apple")).json()

    async def lose(session, user_id, item_id, **kw):
        await session.execute(update(VocabularyItem).where(VocabularyItem.id == item_id).values(reps=99))
        return False

    monkeypatch.setattr(vocab_router, "apply_review", lose)
    r = await review(client, auth_headers, item["id"], "good")
    assert r.status_code == 409 and r.json() == REVIEWED
    stored = (await client.get(URL, headers=auth_headers)).json()["vocabulary_items"][0]
    assert (stored["reps"], stored["box"], stored["last_reviewed_at"]) == (0, 0, None)


async def test_route_row_deleted_between_read_and_update_is_404(client, auth_headers, monkeypatch):
    from sqlalchemy import delete

    item = (await add(client, auth_headers, "apple")).json()

    async def vanish(session, user_id, item_id, **kw):
        await session.execute(delete(VocabularyItem).where(VocabularyItem.id == item_id))
        await session.commit()
        return False

    monkeypatch.setattr(vocab_router, "apply_review", vanish)
    r = await review(client, auth_headers, item["id"], "good")
    assert r.status_code == 404 and r.json() == NOT_FOUND


async def test_due_count_ignores_pagination_and_the_due_filter(app, client, auth_headers):
    ids = [(await add(client, auth_headers, w)).json()["id"] for w in ("a1", "a2", "a3", "a4")]
    await set_due(app, ids[3], utcnow() + timedelta(days=5))
    p2 = (await client.get(URL, headers=auth_headers, params={"due": "true", "per_page": 2, "page": 2})).json()
    assert len(p2["vocabulary_items"]) == 1 and p2["next"] is None and p2["due_count"] == 3
    allp = (await client.get(URL, headers=auth_headers, params={"per_page": 1, "page": 4})).json()
    assert allp["due_count"] == 3


async def test_due_boundary_is_inclusive(app, client, auth_headers, monkeypatch):
    now = utcnow()
    monkeypatch.setattr(vocab_router, "utcnow", lambda: now)
    exact = (await add(client, auth_headers, "exact")).json()
    early = (await add(client, auth_headers, "early")).json()
    late = (await add(client, auth_headers, "late")).json()
    micro = timedelta(microseconds=1)
    await set_due(app, exact["id"], now)
    await set_due(app, early["id"], now - micro)
    await set_due(app, late["id"], now + micro)
    due = (await client.get(URL, headers=auth_headers, params={"due": "true"})).json()
    assert [i["word"] for i in due["vocabulary_items"]] == ["early", "exact"] and due["due_count"] == 2
    assert (await review(client, auth_headers, late["id"], "good")).status_code == 409
    assert (await review(client, auth_headers, late["id"], "good")).json() == NOT_DUE
    assert (await review(client, auth_headers, exact["id"], "good")).status_code == 200
    assert (await review(client, auth_headers, early["id"], "good")).status_code == 200
