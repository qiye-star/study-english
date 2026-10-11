"""自由复习作答:规则表与刷分防护(计划 2026-10-12-wordbook-learned-review S5;R-L6 / R-L7 / R-L8)。"""
from datetime import timedelta

from sqlalchemy import select, update

from app.core import learning_events
from app.models import User, VocabularyItem, WordbookEvent, XpEvent, utcnow
from app.services.stats import as_utc
from app.wordbook import store
from app.wordbook.entry import meaning_line
from app.wordbook.index import dictionary
from tests.test_wordbook_rank_abuse import me, task
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"


async def login(app, client, tmp_path, backdate=True, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="junior,senior", **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    for key in ("talk", "ability", "able"):  # 都是「认识」:盒 2,明天之后到期
        await client.post(f"{URL}/answers", headers=h, json={
            "book_id": "junior", "key": key, "mode": "learn", "qtype": "recall", "rating": "know", "tz_offset_minutes": 480})
    if backdate:  # learned days ago: a just-learned word is not pullable (R-L6)
        async with app.state.sessionmaker() as s:
            await s.execute(update(VocabularyItem).values(created_at=utcnow() - timedelta(days=3)))
            await s.commit()
    return h


async def free(client, h, **body):
    return await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "mode": "free", "tz_offset_minutes": 480, **body})


async def choice(client, h, key, *, right: bool, qtype="word"):
    return await free(client, h, key=key, qtype=qtype, choice=key if right else "stop")


async def row(app, word) -> VocabularyItem:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(VocabularyItem).where(VocabularyItem.word == word))


async def events(app):
    async with app.state.sessionmaker() as s:
        return [(e.kind, e.word, e.qtype, e.outcome) for e in (await s.scalars(select(WordbookEvent).order_by(WordbookEvent.id))).all()]


async def patch(app, word, **values):
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == word).values(**values))
        await s.commit()


def frozen(r: VocabularyItem):
    return (r.box, r.reps, r.lapses, r.last_reviewed_at)


async def test_a_right_answer_changes_nothing_but_records_practice(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    before = await row(app, "talk")
    r = (await choice(client, h, "talk", right=True)).json()
    assert (r["correct"], r["outcome"], r["applied"], r["expected"]) == (True, "correct", False, "talk")
    after = await row(app, "talk")
    assert frozen(after) == frozen(before) and after.due_at == before.due_at
    assert (await events(app))[-1] == ("practice", "talk", "word", "correct")


async def test_a_wrong_answer_pulls_a_future_word_to_now_and_nothing_else(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    before = await row(app, "talk")
    r = (await choice(client, h, "talk", right=False)).json()
    assert (r["correct"], r["outcome"], r["grade"], r["applied"]) == (False, "wrong", "forgot", True)
    after = await row(app, "talk")
    assert frozen(after) == frozen(before)                       # 盒子、reps、lapses、last_reviewed_at 都不变
    assert as_utc(after.due_at) <= utcnow() and r["item"]["box"] == before.box
    batch = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5, "tz_offset_minutes": 480})).json()
    assert [c["key"] for c in batch["cards"]] == ["talk"]        # 进了正式复习队列
    assert (await events(app))[-1][0] == "practice"


async def test_an_already_due_word_is_left_alone(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    overdue = utcnow() - timedelta(days=3)
    await patch(app, "talk", due_at=overdue)
    for right in (True, False):
        r = (await choice(client, h, "talk", right=right)).json()
        assert r["applied"] is False
    after = await row(app, "talk")
    assert as_utc(after.due_at) == as_utc(overdue) and after.reps == 0 and after.last_reviewed_at is None


async def test_quick_recall_only_unknown_counts_as_wrong(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    know = (await free(client, h, key="talk", qtype="recall", rating="know")).json()
    peeked = (await free(client, h, key="ability", qtype="recall", rating="know", revealed_before=True)).json()
    unknown = (await free(client, h, key="able", qtype="recall", rating="unknown")).json()
    assert (know["rating"], know["applied"], know["spot_check"], know["check"]) == ("know", False, False, None)
    assert (peeked["rating"], peeked["applied"]) == ("fuzzy", False)      # 偷看 → 模糊,不算错
    assert (unknown["rating"], unknown["grade"], unknown["applied"]) == ("unknown", "forgot", True)
    assert (await row(app, "able")).box == 2


async def test_fuzzy_twice_does_not_become_unknown_in_free_mode(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    for _ in range(2):
        assert (await free(client, h, key="talk", qtype="recall", rating="fuzzy")).json()["rating"] == "fuzzy"


async def test_spelling_typo_is_neutral_and_wrong_pulls(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    typo = (await free(client, h, key="talk", qtype="spell", typed="talkk")).json()
    assert (typo["outcome"], typo["applied"]) == ("typo", False)
    wrong = (await free(client, h, key="talk", qtype="spell", typed="zqxjvw")).json()
    assert (wrong["outcome"], wrong["applied"]) == ("wrong", True)


async def test_a_word_reviewed_within_24_hours_is_not_pulled(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    reviewed = utcnow() - timedelta(hours=2)
    await patch(app, "talk", last_reviewed_at=reviewed, reps=1)
    before = await row(app, "talk")
    r = (await choice(client, h, "talk", right=False)).json()
    assert r["applied"] is False and (await row(app, "talk")).due_at == before.due_at


async def test_a_word_learned_minutes_ago_is_not_pulled_even_if_never_reviewed(app, client, tmp_path):
    h = await login(app, client, tmp_path, backdate=False)
    before = await row(app, "talk")
    r = (await choice(client, h, "talk", right=False)).json()
    assert r["outcome"] == "wrong" and r["applied"] is False
    assert (await row(app, "talk")).due_at == before.due_at


async def test_daily_pull_cap_still_grades_but_stops_queueing(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(store, "FREE_PULLS_DAILY_MAX", 1)
    first = (await choice(client, h, "talk", right=False)).json()
    second = (await choice(client, h, "ability", right=False)).json()
    assert (first["applied"], second["applied"]) == (True, False) and second["correct"] is False
    assert as_utc((await row(app, "ability")).due_at) > utcnow()


async def test_validation(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await free(client, h, key="talk", qtype="meaning", known=True)).status_code == 422   # known 只给学新词
    assert (await free(client, h, key="talk", qtype="word")).status_code == 422                   # 缺 choice
    assert (await free(client, h, key="talk", qtype="spell")).status_code == 422                  # 缺 typed
    assert (await free(client, h, key="talk", qtype="recall")).json() == {"error": "Rating is required"}
    for body in ({"key": "abandon"}, {"key": "talk", "book_id": "senior"}):                        # 没学过 / 不是这本书学的
        r = await free(client, h, qtype="word", choice="x", **body)
        assert (r.status_code, r.json()) == (404, {"error": "Word not found"}), body


async def test_a_word_from_another_source_is_not_a_free_review_word(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    async with app.state.sessionmaker() as s:
        uid = await s.scalar(select(User.id))
        s.add(VocabularyItem(id="manual-1", user_id=uid, word="absorb", meaning="", source="manual", box=0,
                             due_at=utcnow() + timedelta(days=1), reps=0, lapses=0, created_at=utcnow()))
        await s.commit()
    r = await choice(client, h, "absorb", right=False)
    assert r.status_code == 404


async def test_free_answers_spend_the_shared_daily_answer_cap(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(store, "ANSWERS_DAILY_MAX", 4)  # login 已学了 3 个词(3 次作答),再留 1 次
    assert (await choice(client, h, "talk", right=True)).status_code == 200
    r = await choice(client, h, "talk", right=True)
    assert (r.status_code, r.json()) == (429, {"error": "Daily answer limit reached"})


async def test_free_answers_do_not_move_today_s_plan_or_the_goal(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    before = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()["plan"]
    for _ in range(3):
        await choice(client, h, "talk", right=True)
    after = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()["plan"]
    for key in ("new_done", "review_done", "bonus"):
        assert after[key] == before[key]


async def test_free_answers_publish_one_practice_event_each(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    seen = []
    monkeypatch.setattr(learning_events, "publish", seen.append)
    await choice(client, h, "talk", right=False)
    await free(client, h, key="ability", qtype="recall", rating="know")
    assert [(e.kind, e.word, e.qtype, e.outcome) for e in seen] == [
        ("practice", "talk", "word", "wrong"), ("practice", "ability", "recall", "know")]


async def test_free_answers_cannot_farm_rank_points(app, client, tmp_path):
    """R-L6:错 → 拉到今天到期 → 复习 是唯一能产生 vocab_review 的路径;自由作答本身一个点也不产生。"""
    h = await login(app, client, tmp_path, rank_enabled=True)
    for i in range(12):
        await choice(client, h, "talk", right=bool(i % 2))
        await free(client, h, key="ability", qtype="recall", rating="unknown")
    done = task(await me(client, h), "vocab_reviews")
    assert done["done"] == 0 and done["complete"] is False
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(XpEvent).where(XpEvent.kind == "vocab_review"))).all() == []
        for word in ("talk", "ability"):
            r = (await s.scalars(select(VocabularyItem).where(VocabularyItem.word == word))).one()
            assert (r.reps, r.last_reviewed_at) == (0, None)


async def test_typed_text_and_words_are_not_logged(app, client, tmp_path, caplog):
    caplog.set_level("INFO")  # DEBUG 会带出 aiosqlite 的 SQL 参数(测试环境才开),与路由无关
    h = await login(app, client, tmp_path)
    await free(client, h, key="talk", qtype="spell", typed="zqxjvw")
    assert "zqxjvw" not in caplog.text


async def test_meaning_choice_is_graded_from_the_card(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    line = meaning_line(await dictionary(app).card("junior", "talk"))
    r = (await free(client, h, key="talk", qtype="meaning", choice=line)).json()
    assert (r["correct"], r["correct_option"]) == (True, line)
