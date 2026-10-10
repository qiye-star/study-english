"""goals v2:今天加练、暂停 / 继续、重置进度(spec 2026-10-11 §5、§7、§8)。"""
from datetime import timedelta

import pytest
from sqlalchemy import func, select, update

from app.models import VocabularyItem, WordbookEnrollment, WordbookEvent, XpEvent, utcnow
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
TZ = 480
ELEVEN = ("talk", "ability", "able", "abandon", "absorb", "accept", "accident", "go", "child", "careful", "carry")


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await client.put(f"{URL}/enrollment", headers=h,
                             json={"book_id": "junior", "order_mode": "book"})).status_code == 200
    return h


async def today(client, h) -> dict:
    return (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": TZ})).json()


async def learn(client, h, key):
    return await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": key, "mode": "learn",
                                                                "qtype": "meaning", "known": True,
                                                                "tz_offset_minutes": TZ})


async def bonus(client, h, size):
    return await client.post(f"{URL}/bonus", headers=h, json={"size": size, "tz_offset_minutes": TZ})


async def reset(client, h, confirm, book_id="junior"):
    return await client.post(f"{URL}/enrollment/reset", headers=h,
                             json={"book_id": book_id, "confirm": confirm, "tz_offset_minutes": TZ})


async def rank_me(client, h):
    assert (await client.get("/api/rank/me", headers=h, params={"tz_offset_minutes": TZ})).status_code == 200


@pytest.mark.parametrize("method,path", [("PATCH", "/enrollment"), ("POST", "/enrollment/pause"),
                                         ("POST", "/enrollment/resume"), ("POST", "/enrollment/reset"),
                                         ("POST", "/bonus")])
async def test_goal_routes_are_off_with_the_switch(client, auth_headers, method, path):
    r = await client.request(method, URL + path, headers=auth_headers, json={})
    assert r.status_code == 404 and r.json() == {"error": "Wordbook is disabled"}


async def test_bonus_rules_and_daily_limit(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_bonus_max=6)
    await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 1})
    r = await bonus(client, h, 5)
    assert r.status_code == 409 and r.json() == {"error": "Finish today's new words first"}
    assert (await learn(client, h, "talk")).status_code == 200
    r = await bonus(client, h, 5)
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["plan"]["new_target"], body["plan"]["new_left"], body["plan"]["bonus"], body["bonus_left"]) == (6, 5, 5, 1)
    assert (await bonus(client, h, 1)).json() == {"error": "Finish today's new words first"}
    for key in ("ability", "able", "abandon", "absorb", "go"):
        assert (await learn(client, h, key)).status_code == 200
    assert (await learn(client, h, "accept")).json() == {"error": "Daily new-word limit reached"}
    r = await bonus(client, h, 5)
    assert r.status_code == 429 and r.json() == {"error": "Daily bonus limit reached"}
    assert (await bonus(client, h, 1)).status_code == 200  # 正好用完上限
    t = await today(client, h)
    assert (t["plan"]["bonus"], t["plan"]["goal_met"]) == (6, True)
    assert (await bonus(client, h, 21)).status_code == 422  # 每次最多 20


async def test_bonus_after_lowering_the_goal_still_gives_that_many_new_words(app, client, tmp_path):
    """评审 Z1 R-1:今天已学 3 个后把每日新词调到 1,再加练 2 个 —— 必须真的还能学 2 个(之前 new_target = 1 + 2 = 3,
    new_left = 0,加练白扣次数与额度)。加练记账含超出部分:credit = 2 + (3 − 1)。"""
    h = await login(app, client, tmp_path, wordbook_bonus_max=10)
    await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 3})
    for key in ("talk", "ability", "able"):
        assert (await learn(client, h, key)).status_code == 200
    await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 1})
    r = await bonus(client, h, 2)
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["plan"]["new_done"], body["plan"]["new_left"], body["plan"]["bonus"], body["bonus_left"]) == (3, 2, 4, 6)
    for key in ("abandon", "absorb"):
        assert (await learn(client, h, key)).status_code == 200
    assert (await learn(client, h, "accept")).json() == {"error": "Daily new-word limit reached"}
    assert (await bonus(client, h, 7)).json() == {"error": "Daily bonus limit reached"}  # 4 + 7 > 10


async def test_bonus_is_refused_during_a_backlog_and_when_switched_off(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    for key in ELEVEN:
        assert (await learn(client, h, key)).status_code == 200
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 11, "review_cap": 10})
    assert (await bonus(client, h, 5)).json() == {"error": "Clear the review backlog first"}
    app.state.settings = app.state.settings.model_copy(update={"wordbook_bonus_max": 0})
    assert (await bonus(client, h, 5)).json() == {"error": "Daily bonus limit reached"}


async def test_pause_shows_the_paused_card_and_resume_keeps_settings(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 7})
    r = await client.post(f"{URL}/enrollment/pause", headers=h, json={})
    assert r.status_code == 200 and r.json()["status"] == "paused"
    t = await today(client, h)
    assert t["enrollment"] is None and t["plan"] is None and t["paused"]["book_id"] == "junior"
    assert (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 5})).json() == {"error": "No active book"}
    assert (await client.post(f"{URL}/enrollment/pause", headers=h, json={})).json() == {"error": "No active book"}
    r = await client.post(f"{URL}/enrollment/resume", headers=h, json={"book_id": "junior"})
    assert r.status_code == 200 and (r.json()["status"], r.json()["daily_new"]) == ("active", 7)
    assert (await today(client, h))["paused"] is None
    r = await client.post(f"{URL}/enrollment/resume", headers=h, json={"book_id": "cet4"})
    assert r.status_code == 409 and r.json() == {"error": "Book not enrolled"}


async def test_reset_clears_only_this_books_rows_and_keeps_history(app, client, tmp_path):
    h = await login(app, client, tmp_path, rank_enabled=True)
    await client.post("/api/vocabulary", headers=h, json={"word": "accept", "source": "lookup"})
    for key in ("talk", "ability"):
        assert (await learn(client, h, key)).status_code == 200
    await rank_me(client, h)
    r = await reset(client, h, "四级")
    assert r.status_code == 422 and r.json() == {"error": "Confirmation does not match"}
    r = await reset(client, h, " 初中 ")
    assert r.status_code == 200 and r.json()["removed"] == 2 and r.json()["enrollment"]["book_id"] == "junior"
    t = await today(client, h)
    assert t["progress"]["learned"] == 1  # accept 来自查词,不清除
    assert t["plan"]["new_done"] == 2  # 事件保留:重置换不来更多今日新词
    async with app.state.sessionmaker() as s:
        kinds = (await s.scalars(select(WordbookEvent.kind).order_by(WordbookEvent.id))).all()
        xp = (await s.scalars(select(XpEvent).where(XpEvent.kind == "word_learned"))).all()
        row = await s.scalar(select(WordbookEnrollment))
    assert kinds == ["learn", "learn", "reset"] and len(xp) == 2 and row.cursor == 0
    assert (await learn(client, h, "talk")).status_code == 200
    await rank_me(client, h)
    async with app.state.sessionmaker() as s:
        last = (await s.scalars(select(WordbookEvent.kind).order_by(WordbookEvent.id.desc()).limit(1))).one()
        assert last == "relearn"
        assert len((await s.scalars(select(XpEvent).where(XpEvent.kind == "word_learned"))).all()) == 2
    assert (await today(client, h))["plan"]["new_done"] == 2  # talk 今天已经算过


async def test_reset_settles_unsynced_review_points_first(app, client, tmp_path):
    h = await login(app, client, tmp_path, rank_enabled=True)
    await learn(client, h, "talk")
    await rank_me(client, h)
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    q = (await client.post(f"{URL}/review/batch", headers=h,
                           json={"size": 1, "tz_offset_minutes": TZ})).json()["questions"][0]
    answer = {"choice": "x"} if q["options"] else {"typed": "x"}
    r = await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": "talk", "mode": "review",
                                                            "qtype": q["qtype"], "tz_offset_minutes": TZ, **answer})
    assert r.json()["applied"] is True
    assert (await reset(client, h, "junior")).status_code == 200  # 中间没有调用 /rank/me
    async with app.state.sessionmaker() as s:
        assert len((await s.scalars(select(XpEvent).where(XpEvent.kind == "vocab_review"))).all()) == 1


async def test_a_rejected_reset_never_syncs_rank(app, client, tmp_path, monkeypatch):
    """集成裁定 Z1-b:确认文本、选书记录、每日次数都先校验;被拒的重置不触发段位同步,通过的才同步(且在删除前)。"""
    from app.routers import wordbook as router
    from app.wordbook import store
    monkeypatch.setattr(store, "RESETS_DAILY_MAX", 1)
    calls: list[int] = []

    async def fake_sync(session, user_id, *args, **kwargs):
        rows = await session.scalar(select(func.count()).select_from(VocabularyItem))
        calls.append(rows)

    monkeypatch.setattr(router.ledger, "sync", fake_sync)
    h = await login(app, client, tmp_path, rank_enabled=True)
    assert (await learn(client, h, "talk")).status_code == 200
    assert (await reset(client, h, "四级")).json() == {"error": "Confirmation does not match"}
    assert (await reset(client, h, "cet4", book_id="cet4")).json() == {"error": "Book not enrolled"}
    assert (await reset(client, h, "初中", book_id="nope")).json() == {"error": "Book not found"}
    assert calls == []
    assert (await reset(client, h, "初中")).status_code == 200
    assert calls == [1]  # 同步时本书的行还在
    assert (await reset(client, h, "初中")).json() == {"error": "Daily reset limit reached"}
    assert calls == [1]


async def test_reset_limits_and_unknown_books(app, client, tmp_path, monkeypatch):
    from app.wordbook import store
    monkeypatch.setattr(store, "RESETS_DAILY_MAX", 1)
    h = await login(app, client, tmp_path)
    assert (await reset(client, h, "cet4", book_id="cet4")).json() == {"error": "Book not enrolled"}
    assert (await reset(client, h, "Junior High")).status_code == 200  # 英文名也可以,不区分大小写
    r = await reset(client, h, "初中")
    assert r.status_code == 429 and r.json() == {"error": "Daily reset limit reached"}
