"""发音弱词 ↔ 跟读(learning-links spec §6.4,计划 L4-1)。"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.core.learning_events import AssessmentFinished, WeakWord, bind, publish
from app.links import pron_shadow
from app.models import LinkWeakWord
from tests.links_helpers import check_contract, drain, enable_links, user_id_of
from tests.wordbook_helpers import enable_wordbook, make_data_dir

T0 = datetime(2026, 10, 11, 8, 0, tzinfo=timezone.utc)


def ev(uid, minutes, weak=(), good=(), source="practice"):
    return AssessmentFinished(user_id=uid, assessment_id=f"a{minutes}", source=source, score=60,
                              weak_words=tuple(WeakWord(w, s) for w, s in weak), good_words=tuple(good),
                              at=T0 + timedelta(minutes=minutes))


async def login(app, client, name="alice", **flags):
    enable_links(app, **flags)
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return await user_id_of(client, h), h


async def get(app, uid, word):
    async with app.state.sessionmaker() as s:
        return await s.get(LinkWeakWord, (uid, word))


async def rows_of(app):
    async with app.state.sessionmaker() as s:
        return int(await s.scalar(select(func.count()).select_from(LinkWeakWord)))


async def test_weak_words_enter_and_clear_after_two_good_readings(app, client):
    uid, _ = await login(app, client)
    await pron_shadow.handle(app, ev(uid, 0, weak=[("three", 41), ("thought", None)]))
    await pron_shadow.handle(app, ev(uid, 1, weak=[("three", 52)]))
    r = await get(app, uid, "three")
    assert (r.hits, r.last_score, r.cleared_at) == (2, 52, None)
    await pron_shadow.handle(app, ev(uid, 2, good=["three"]))
    await pron_shadow.handle(app, ev(uid, 3, good=["three", "tree"]))
    assert (await get(app, uid, "three")).cleared_at is not None
    assert await get(app, uid, "tree") is None  # good readings alone create nothing
    assert (await get(app, uid, "thought")).last_score is None


async def test_a_weak_reading_resets_the_good_streak_and_revives_a_cleared_word(app, client):
    uid, _ = await login(app, client)
    await pron_shadow.handle(app, ev(uid, 0, weak=[("three", 41)]))
    await pron_shadow.handle(app, ev(uid, 1, good=["three"]))
    await pron_shadow.handle(app, ev(uid, 2, weak=[("three", 50)]))
    await pron_shadow.handle(app, ev(uid, 3, good=["three"]))
    r = await get(app, uid, "three")
    assert (r.hits, r.ok_streak, r.cleared_at) == (2, 1, None)
    await pron_shadow.handle(app, ev(uid, 4, good=["three"]))
    assert (await get(app, uid, "three")).cleared_at is not None
    await pron_shadow.handle(app, ev(uid, 5, weak=[("three", 30)]))
    r = await get(app, uid, "three")
    assert (r.hits, r.ok_streak, r.cleared_at, r.last_score) == (3, 0, None, 30)


async def test_chat_assessments_replays_and_older_events_are_ignored(app, client):
    """Owner ruling: chat / voice low-scoring words do not count (shadowing assessments only, L-R3)."""
    uid, _ = await login(app, client)
    await pron_shadow.handle(app, ev(uid, 0, weak=[("three", 40)], source="chat"))
    assert await get(app, uid, "three") is None
    e = ev(uid, 5, weak=[("three", 40)])
    await pron_shadow.handle(app, e)
    await pron_shadow.handle(app, e)
    await pron_shadow.handle(app, ev(uid, 1, weak=[("three", 10)]))
    assert (await get(app, uid, "three")).hits == 1


async def test_active_weak_words_are_capped_by_retiring_the_oldest(app, client, monkeypatch):
    monkeypatch.setattr(pron_shadow, "ACTIVE_MAX", 3)
    uid, _ = await login(app, client)
    for i, word in enumerate(["alpha", "bravo", "charlie", "delta"]):
        await pron_shadow.handle(app, ev(uid, i, weak=[(word, 40)]))
    assert (await get(app, uid, "alpha")).cleared_at is not None
    assert [(await get(app, uid, w)).cleared_at for w in ("bravo", "charlie", "delta")] == [None, None, None]


async def test_list_dismiss_and_example_from_the_users_vocabulary(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))  # so the contract also records a today-words item
    uid, h = await login(app, client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "key": "talk", "mode": "learn",
                                                                "qtype": "meaning", "known": True})
    await client.post("/api/vocabulary", headers=h, json={"word": "three", "example": "Three trees.", "source": "manual"})
    bind(app.state.learning_bus)  # go through the real channel (gate included) instead of calling handle()
    assert publish(ev(uid, 0, weak=[("three", 41), ("world", 55)]))
    await drain(app)
    body = (await client.get("/api/links/weak-words", headers=h)).json()
    assert body["total"] == 2
    three = next(i for i in body["items"] if i["word"] == "three")
    assert (three["hits"], three["last_score"], three["example"]) == (1, 41, "Three trees.")
    dismissed = (await client.post("/api/links/weak-words/dismiss", headers=h, json={"word": "world"})).json()
    assert dismissed == {"word": "world"}
    assert [i["word"] for i in (await client.get("/api/links/weak-words", headers=h)).json()["items"]] == ["three"]
    today = (await client.get("/api/links/today-words", headers=h)).json()
    assert [i["key"] for i in today["items"]] == ["talk"]
    check_contract("links_pron_shadow_contract", {"list": body, "dismiss": dismissed, "today_words": today})


async def test_list_orders_by_hits_then_recency_and_only_shows_my_words(app, client):
    uid, h = await login(app, client)
    other, _ = await login(app, client, name="bob")
    await pron_shadow.handle(app, ev(uid, 0, weak=[("old", 40), ("busy", 40)]))
    await pron_shadow.handle(app, ev(uid, 1, weak=[("busy", 45), ("new", 50)]))
    await pron_shadow.handle(app, ev(other, 2, weak=[("theirs", 30)]))
    body = (await client.get("/api/links/weak-words", headers=h)).json()
    assert [i["word"] for i in body["items"]] == ["busy", "new", "old"]
    assert body["total"] == 3 and body["items"][0]["example"] is None
    await client.post("/api/links/weak-words/dismiss", headers=h, json={"word": "theirs"})
    assert (await get(app, other, "theirs")).cleared_at is None


async def test_link_off_means_404_and_no_rows(app, client):
    uid, h = await login(app, client, link_pron_shadow_enabled=False)
    for path in ("/api/links/weak-words", "/api/links/today-words"):
        r = await client.get(path, headers=h)
        assert (r.status_code, r.json()) == (404, {"error": "Link is off"})
    r = await client.post("/api/links/weak-words/dismiss", headers=h, json={"word": "three"})
    assert r.status_code == 404
    bind(app.state.learning_bus)
    publish(ev(uid, 0, weak=[("three", 41)]))
    await drain(app)
    assert await rows_of(app) == 0
    assert app.state.learning_bus.stats()["pron_shadow"]["skipped"] == 1


async def test_user_pref_off_skips_the_handler(app, client):
    uid, h = await login(app, client)
    await client.put("/api/links/prefs", headers=h, json={"key": "pron_shadow", "enabled": False})
    bind(app.state.learning_bus)
    publish(ev(uid, 0, weak=[("three", 41)]))
    await drain(app)
    assert await rows_of(app) == 0
    assert (await client.get("/api/links/weak-words", headers=h)).status_code == 404


async def test_today_words_lists_todays_new_words_with_their_first_example(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    uid, h = await login(app, client)
    assert (await client.get("/api/links/today-words", headers=h)).json() == {"items": []}  # no active book
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    for key in ("talk", "ability"):
        await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "key": key, "mode": "learn",
                                                                    "qtype": "meaning", "known": True,
                                                                    "tz_offset_minutes": 0})
    items = (await client.get("/api/links/today-words", headers=h, params={"offset": 0})).json()["items"]
    assert [i["key"] for i in items] == ["talk", "ability"]
    assert items[0]["example"]["en"].startswith("I could hear Sarah and Andy talking")


async def test_today_words_are_empty_when_the_wordbook_is_off(app, client):
    _, h = await login(app, client)
    assert (await client.get("/api/links/today-words", headers=h)).json() == {"items": []}
    assert (await client.get("/api/links/today-words", headers=h, params={"offset": 9999})).status_code == 422
