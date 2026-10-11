from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.learning_events import WordAnswered
from app.links import mistakes
from app.models import LinkMistakeWord
from tests.links_helpers import check_contract, drain, enable_links, user_id_of
from tests.wordbook_helpers import enable_wordbook, make_data_dir

T0 = datetime(2026, 10, 11, 8, 0, tzinfo=timezone.utc)


def ev(uid, word, outcome, minutes, kind="review"):
    return WordAnswered(user_id=uid, book_id="junior", word=word, kind=kind, qtype="meaning", outcome=outcome,
                        credit=0, at=T0 + timedelta(minutes=minutes))


async def login(app, client, name="alice", **flags):
    enable_links(app, **flags)
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return await user_id_of(client, h), h


async def row(app, uid, word):
    async with app.state.sessionmaker() as s:
        return await s.get(LinkMistakeWord, (uid, word))


async def test_wrong_answers_enter_and_two_right_answers_clear(app, client):
    uid, _ = await login(app, client)
    await mistakes.handle(app, ev(uid, "talk", "wrong", 0))
    await mistakes.handle(app, ev(uid, "talk", "inflection", 1))
    await mistakes.handle(app, ev(uid, "talk", "typo", 2))  # typos do not count
    r = await row(app, uid, "talk")
    assert (r.wrong_count, r.ok_streak, r.cleared_at) == (2, 0, None)
    await mistakes.handle(app, ev(uid, "talk", "correct", 3))
    assert (await row(app, uid, "talk")).cleared_at is None
    await mistakes.handle(app, ev(uid, "talk", "known", 4))
    assert (await row(app, uid, "talk")).cleared_at is not None
    await mistakes.handle(app, ev(uid, "talk", "wrong", 5))  # a new mistake reopens it
    r = await row(app, uid, "talk")
    assert (r.wrong_count, r.cleared_at) == (3, None)
    await mistakes.handle(app, ev(uid, "ability", "correct", 6))  # a right answer alone creates nothing
    assert await row(app, uid, "ability") is None


async def test_self_rating_outcomes_follow_the_index_rules(app, client):
    """A 的三档自评(INDEX R-E3):新词标「不认识」不算错;复习 / 当天再评的「不认识」算错;fuzzy、know_chk 中性;know 算对。"""
    uid, _ = await login(app, client)
    await mistakes.handle(app, ev(uid, "talk", "unknown", 0, kind="learn"))
    await mistakes.handle(app, ev(uid, "talk", "unknown", 1, kind="relearn"))
    assert await row(app, uid, "talk") is None
    await mistakes.handle(app, ev(uid, "talk", "unknown", 2, kind="review"))
    assert (await row(app, uid, "talk")).wrong_count == 1
    await mistakes.handle(app, ev(uid, "talk", "fuzzy", 3))
    await mistakes.handle(app, ev(uid, "talk", "know_chk", 4, kind="practice"))
    r = await row(app, uid, "talk")
    assert (r.ok_streak, r.cleared_at) == (0, None)
    await mistakes.handle(app, ev(uid, "talk", "know", 5))
    await mistakes.handle(app, ev(uid, "talk", "correct", 6))
    assert (await row(app, uid, "talk")).cleared_at is not None
    await mistakes.handle(app, ev(uid, "talk", "unknown", 7, kind="practice"))  # 「记错了」重新打开
    assert (await row(app, uid, "talk")).cleared_at is None


async def test_replays_and_older_events_are_ignored(app, client):
    uid, _ = await login(app, client)
    e = ev(uid, "talk", "wrong", 10)
    await mistakes.handle(app, e)
    await mistakes.handle(app, e)
    await mistakes.handle(app, ev(uid, "talk", "wrong", 5))
    assert (await row(app, uid, "talk")).wrong_count == 1


async def test_active_list_is_capped(app, client, monkeypatch):
    monkeypatch.setattr(mistakes, "ACTIVE_MAX", 3)
    uid, _ = await login(app, client)
    for i, word in enumerate(("a1", "a2", "a3", "a4")):
        await mistakes.handle(app, ev(uid, word, "wrong", i))
    async with app.state.sessionmaker() as s:
        active = (await s.scalars(select(LinkMistakeWord.word).where(LinkMistakeWord.cleared_at.is_(None)))).all()
    assert sorted(active) == ["a2", "a3", "a4"]


async def test_end_to_end_through_the_bus_list_and_dismiss(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    uid, h = await login(app, client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "key": "talk", "mode": "learn",
                                                                "qtype": "meaning", "choice": "nope"})
    await drain(app)
    body = (await client.get("/api/links/mistakes", headers=h)).json()
    assert body["total"] == 1 and body["next"] is None
    (item,) = body["items"]
    assert (item["word"], item["wrong_count"], item["book_id"], item["box"]) == ("talk", 1, "junior", 0)
    assert item["meaning"]  # from the user's own vocabulary row (no copy)
    dismissed = (await client.post("/api/links/mistakes/dismiss", headers=h, json={"word": "Talk"})).json()
    assert dismissed == {"word": "talk"}
    assert (await client.get("/api/links/mistakes", headers=h)).json()["items"] == []
    check_contract("links_mistakes_contract", {"list": body, "dismiss": dismissed})


async def test_nothing_is_written_when_the_user_turned_it_off(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    uid, h = await login(app, client)
    await client.put("/api/links/prefs", headers=h, json={"key": "mistakes", "enabled": False})
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "key": "talk", "mode": "learn",
                                                                "qtype": "meaning", "choice": "nope"})
    await drain(app)
    assert await row(app, uid, "talk") is None
    assert app.state.learning_bus.stats()["mistakes"]["skipped"] == 1
    assert (await client.get("/api/links/mistakes", headers=h)).status_code == 404


async def test_neutral_outcomes_do_not_advance_the_event_clock(app, client):
    uid, _ = await login(app, client)
    await mistakes.handle(app, ev(uid, "talk", "wrong", 0))
    await mistakes.handle(app, ev(uid, "talk", "fuzzy", 10))
    await mistakes.handle(app, ev(uid, "talk", "typo", 11))
    await mistakes.handle(app, ev(uid, "talk", "correct", 5))  # still newer than the last counted event
    r = await row(app, uid, "talk")
    assert (r.wrong_count, r.ok_streak) == (1, 1)


async def test_list_is_ordered_paged_and_private(app, client):
    uid, h = await login(app, client)
    other, h2 = await login(app, client, name="bob")
    for i in range(22):
        await mistakes.handle(app, ev(uid, f"w{i:02d}", "wrong", i))
    await mistakes.handle(app, ev(uid, "w00", "wrong", 30))
    await mistakes.handle(app, ev(other, "secret", "wrong", 0))
    first = (await client.get("/api/links/mistakes", headers=h)).json()
    assert first["total"] == 22 and first["next"] == 2 and len(first["items"]) == 20
    assert [i["word"] for i in first["items"][:3]] == ["w00", "w21", "w20"]  # most wrong first, then latest
    assert first["items"][0]["meaning"] == "" and first["items"][0]["box"] is None  # not in the notebook
    second = (await client.get("/api/links/mistakes?page=2", headers=h)).json()
    assert [i["word"] for i in second["items"]] == ["w02", "w01"] and second["next"] is None
    assert (await client.get("/api/links/mistakes?page=0", headers=h)).status_code == 422
    # bob cannot see or dismiss alice's rows
    assert [i["word"] for i in (await client.get("/api/links/mistakes", headers=h2)).json()["items"]] == ["secret"]
    await client.post("/api/links/mistakes/dismiss", headers=h2, json={"word": "w00"})
    assert (await row(app, uid, "w00")).cleared_at is None
    assert (await client.post("/api/links/mistakes/dismiss", headers=h, json={"word": "w00", "x": 1})).status_code == 422
