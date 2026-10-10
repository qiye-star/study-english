from datetime import timedelta

from sqlalchemy import select, update

from app.models import VocabularyItem, WordbookEvent, utcnow
from app.wordbook import store
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
TALK_MEANING = "v. 说话；谈话；n. 交谈"


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h


async def ans(client, h, **body):
    return await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "tz_offset_minutes": 480, **body})


async def make_due(app, word):
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == word)
                        .values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()


async def test_learn_batch_returns_cards_and_meaning_quiz(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    body = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 5})).json()
    assert body["book_id"] == "junior"
    assert [c["key"] for c in body["cards"]] == ["talk", "ability", "able", "abandon", "absorb"]
    assert body["cards"][0]["us"] == "tɔk" and body["cards"][0]["examples"][0]["id"]
    assert [q["key"] for q in body["quiz"]] == [c["key"] for c in body["cards"]]
    q = body["quiz"][0]
    assert q["qtype"] == "meaning" and q["key"] == "talk" and TALK_MEANING in q["options"] and len(q["options"]) == 4
    assert q["length"] is None and q["prompt"]["word"] == "talk"
    async with app.state.sessionmaker() as s:  # 不建行
        assert (await s.scalars(select(VocabularyItem))).all() == []


async def test_learn_batch_respects_daily_target(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "daily_new": 5})
    for key in ("talk", "ability", "able", "abandon"):
        await ans(client, h, key=key, mode="learn", qtype="meaning", known=True)
    body = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 5, "tz_offset_minutes": 480})).json()
    assert [c["key"] for c in body["cards"]] == ["absorb"]


async def test_learn_answer_creates_item_once_and_advances_cursor(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)).json()
    assert (r["correct"], r["outcome"], r["grade"], r["applied"], r["item"]["box"]) == (True, "correct", "good", True, 0)
    assert r["expected"] == "talk" and r["diff"] is None
    again = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice="x")).json()
    assert (again["correct"], again["applied"]) == (False, False)
    known = (await ans(client, h, key="ability", mode="learn", qtype="meaning", known=True)).json()
    assert known["outcome"] == "known" and known["item"]["box"] == 2
    nxt = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 2})).json()
    assert [c["key"] for c in nxt["cards"]] == ["able", "abandon"]
    async with app.state.sessionmaker() as s:
        kinds = (await s.scalars(select(WordbookEvent.kind).order_by(WordbookEvent.id))).all()
        assert kinds == ["learn", "practice", "learn"]
        rows = (await s.scalars(select(VocabularyItem.source))).all()
        assert set(rows) == {"wordbook:junior"}
        assert (await store.get_enrollment(s, (await s.scalar(select(VocabularyItem.user_id))), "junior")).cursor == 2
    today = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()
    assert today["plan"]["new_done"] == 2 and today["progress"]["learned"] == 2


async def test_answers_name_the_correct_option_explicitly(app, client, tmp_path):
    """`/answers` 的 `correct_option` = 正确选项的原文(选择题),客户端直接按它标绿,不用自己重建释义行;
    `expected` 恒为词头(打字题与讲解用)。打字题与「我认识」没有选项 → null。"""
    h = await login(app, client, tmp_path)
    quiz = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 5})).json()["quiz"]
    talk = next(q for q in quiz if q["key"] == "talk")
    wrong = next(o for o in talk["options"] if o != TALK_MEANING)
    r = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=wrong)).json()
    assert (r["correct"], r["expected"], r["correct_option"]) == (False, "talk", TALK_MEANING)
    assert r["correct_option"] in talk["options"]
    word = (await ans(client, h, key="talk", mode="review", qtype="word", choice="stop")).json()
    assert word["correct_option"] == "talk"
    typed = (await ans(client, h, key="talk", mode="review", qtype="spell", typed="talk")).json()
    assert typed["correct_option"] is None and typed["expected"] == "talk"
    known = (await ans(client, h, key="able", mode="learn", qtype="meaning", known=True)).json()
    assert known["correct_option"] is None


async def test_learn_adopts_an_existing_vocabulary_word(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await client.post("/api/vocabulary", headers=h, json={"word": "talk", "source": "lookup"})
    body = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 1})).json()
    assert [c["key"] for c in body["cards"]] == ["ability"]
    r = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)).json()
    assert r["applied"] is False  # 已有行(任何来源)不再建行
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(VocabularyItem.source))).all() == ["lookup"]


async def test_review_due_rules(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)
    await ans(client, h, key="go", mode="learn", qtype="meaning", choice="x")
    await make_due(app, "talk")
    batch = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 20})).json()
    assert [q["key"] for q in batch["questions"]] == ["talk"]
    assert [c["key"] for c in batch["cards"]] == ["talk"]  # 列表,不是以词为键的映射
    assert batch["questions"][0]["qtype"] in ("meaning", "word")  # 盒 0
    typo = (await ans(client, h, key="talk", mode="review", qtype="spell", typed="talkk")).json()
    assert (typo["outcome"], typo["grade"], typo["applied"], typo["item"]["box"]) == ("typo", "hard", True, 0)
    assert {"op": "ins", "a": "", "b": "k"} in typo["diff"]
    practice = (await ans(client, h, key="talk", mode="review", qtype="spell", typed="talk")).json()
    assert practice["applied"] is False  # 不再到期:只记练习
    wrong = (await ans(client, h, key="go", mode="review", qtype="word", choice="stop")).json()
    assert (wrong["grade"], wrong["applied"]) == ("forgot", True)  # 未到期但答错 → forgot(R-W5)
    today = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()
    assert today["plan"]["review_done"] == 1
    async with app.state.sessionmaker() as s:
        kinds = (await s.scalars(select(WordbookEvent.kind).order_by(WordbookEvent.id))).all()
        assert kinds == ["learn", "learn", "review", "practice", "practice"]


async def test_review_good_moves_box_and_hint_makes_it_hard(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)
    await ans(client, h, key="able", mode="learn", qtype="meaning", choice="x")
    await make_due(app, "talk")
    await make_due(app, "able")
    good = (await ans(client, h, key="talk", mode="review", qtype="word", choice="Talk")).json()
    assert (good["grade"], good["item"]["box"]) == ("good", 1)
    hinted = (await ans(client, h, key="able", mode="review", qtype="dictation", typed="able", hinted=True)).json()
    assert (hinted["outcome"], hinted["grade"], hinted["item"]["box"]) == ("correct", "hard", 0)


async def test_answer_validation_limits_and_unknown_word(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    r = await ans(client, h, key="nope", mode="learn", qtype="meaning", choice="x")
    assert r.status_code == 404 and r.json() == {"error": "Word not found"}
    r = await client.post(f"{URL}/answers", headers=h, json={"book_id": "bogus", "key": "talk", "mode": "learn",
                                                            "qtype": "meaning", "choice": "x"})
    assert r.status_code == 404 and r.json() == {"error": "Book not found"}
    r = await client.post(f"{URL}/answers", headers=h, json={"book_id": "toefl", "key": "talk", "mode": "learn",
                                                            "qtype": "meaning", "choice": "x"})
    assert r.status_code == 503 and r.json() == {"error": "Wordbook data unavailable"}
    assert (await ans(client, h, key="talk", mode="learn", qtype="spell")).status_code == 422
    assert (await ans(client, h, key="talk", mode="learn", qtype="meaning")).status_code == 422
    assert (await ans(client, h, key="talk", mode="review", qtype="meaning", known=True)).status_code == 422
    assert (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice="x", extra=1)).status_code == 422
    assert (await ans(client, h, key="talk", mode="learn", qtype="spell", typed="t" * 101)).status_code == 422
    monkeypatch.setattr(store, "ANSWERS_DAILY_MAX", 1)
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)
    r = await ans(client, h, key="able", mode="learn", qtype="meaning", choice="x")
    assert r.status_code == 429 and r.json() == {"error": "Daily answer limit reached"}


async def test_answers_are_not_logged(app, client, tmp_path, caplog):
    caplog.set_level("DEBUG")
    h = await login(app, client, tmp_path)
    await ans(client, h, key="talk", mode="learn", qtype="spell", typed="zqxjvw")
    assert "zqxjvw" not in caplog.text


async def test_no_active_book(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    r = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = await client.post(f"{URL}/learn/batch", headers=h, json={})
    assert r.status_code == 409 and r.json() == {"error": "No active book"}
    assert (await client.post(f"{URL}/review/batch", headers=h, json={})).status_code == 409
