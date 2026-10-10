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


async def test_due_quick_recall_grades_good_hard_forgot(app, client, tmp_path, monkeypatch):
    always_recall(monkeypatch)
    h = await login(app, client, tmp_path)
    for key in ("talk", "ability", "able"):
        await rate(client, h, key, "fuzzy")  # 盒 1
        await make_due(app, key)
    batch = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5, "recall": True})).json()
    assert {q["qtype"] for q in batch["questions"]} == {"recall"}
    q = next(q for q in batch["questions"] if q["key"] == "talk")
    assert q["prompt"] == {"word": "talk", "us": "tɔk"} and q["options"] is None and q["length"] is None
    good = await rate(client, h, "talk", "know", mode="review")
    assert (good["grade"], good["applied"], good["item"]["box"]) == ("good", True, 2)
    hard = await rate(client, h, "ability", "unknown", mode="review")
    assert (hard["grade"], hard["item"]["box"]) == ("forgot", 0)
    assert [e[0] for e in await events(app)][-2:] == ["review", "review"]
    assert (await row(app, "talk")).reps == 1  # 到期复习:与其它题型一样产生一次 vocab_review


async def test_recall_is_offered_only_when_declared_and_enabled(app, client, tmp_path, monkeypatch):
    always_recall(monkeypatch)
    h = await login(app, client, tmp_path)
    await rate(client, h, "talk", "fuzzy")
    await make_due(app, "talk")
    legacy = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5})).json()
    assert legacy["questions"][0]["qtype"] != "recall"
    enable_wordbook(app, make_data_dir(tmp_path), wordbook_recall_enabled=False)
    off = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5, "recall": True})).json()
    assert off["questions"][0]["qtype"] != "recall"
    r = await ans(client, h, key="talk", mode="review", qtype="recall", rating="know")
    assert r.status_code == 422 and r.json() == {"error": "Question type mismatch"}


async def test_new_word_ratings_set_boxes_and_each_word_counts_once(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    know = await rate(client, h, "talk", "know", elapsed_ms=4000)
    assert (know["rating"], know["outcome"], know["spot_check"], know["item"]["box"], know["applied"]) == (
        "know", "know", False, 2, True)
    assert know["check"] is None and know["grade"] == "good" and know["correct"] is True
    assert (await rate(client, h, "ability", "fuzzy"))["item"]["box"] == 1
    assert (await rate(client, h, "able", "unknown"))["item"]["box"] == 0
    peeked = await rate(client, h, "abandon", "know", revealed_before=True)
    assert (peeked["rating"], peeked["item"]["box"], peeked["correct"]) == ("fuzzy", 1, False)
    assert await events(app) == [("learn", "talk", "recall", "know"), ("learn", "ability", "recall", "fuzzy"),
                                 ("learn", "able", "recall", "unknown"), ("learn", "abandon", "recall", "fuzzy")]
    item = await row(app, "talk")
    assert (item.reps, item.last_reviewed_at) == (0, None)  # 不是复习:不产生 vocab_review
    today = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()
    assert today["plan"]["new_done"] == 4
    nxt = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 1})).json()
    assert [c["key"] for c in nxt["cards"]] == ["absorb"]  # cursor 前进


async def test_rating_on_a_new_word_obeys_the_daily_new_limit(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "daily_new": 5})
    for key in ("talk", "ability", "able", "abandon", "absorb"):
        await rate(client, h, key, "know")
    r = await ans(client, h, key="accept", mode="learn", qtype="recall", rating="know")
    assert r.status_code == 429 and r.json() == {"error": "Daily new-word limit reached"}


async def test_spot_checked_know_starts_at_box_1_and_the_round_quiz_decides(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_spot_check_pct=100)
    talk = await rate(client, h, "talk", "know")
    assert (talk["rating"], talk["spot_check"], talk["item"]["box"]) == ("know", True, 1)
    passed = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=await meaning(app, "talk"))).json()
    assert (passed["correct"], passed["applied"], passed["item"]["box"]) == (True, True, 2)
    again = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=await meaning(app, "talk"))).json()
    assert (again["applied"], again["item"]["box"]) == (False, 2)  # 只升一次
    await rate(client, h, "ability", "know")
    failed = (await ans(client, h, key="ability", mode="learn", qtype="meaning", choice="x")).json()
    assert (failed["correct"], failed["applied"], failed["item"]["box"]) == (False, True, 0)
    ability = await row(app, "ability")
    assert (ability.reps, ability.lapses, ability.last_reviewed_at) == (0, 1, None)
    assert [e[3] for e in await events(app)] == ["know_chk", "correct", "correct", "know_chk", "wrong"]
    assert [e[0] for e in await events(app)] == ["learn", "practice", "practice", "learn", "practice"]


async def test_fast_taps_are_always_checked(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_spot_check_pct=1)
    async with app.state.sessionmaker() as s:
        uid = await s.scalar(select(User.id).where(User.username == "alice"))
        await s.execute(update(WordbookEnrollment).values(seed=1))
        await s.commit()
    assert (await rate(client, h, "talk", "know", elapsed_ms=400))["spot_check"] is True
    slow = await rate(client, h, "ability", "know", elapsed_ms=5000)
    assert slow["spot_check"] is recall.spot_hit(1, uid, "ability", 0, 1)


async def test_no_checks_at_all_when_the_ratio_is_zero(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_spot_check_pct=0)
    assert (await rate(client, h, "talk", "know", elapsed_ms=10))["spot_check"] is False


async def test_a_round_quiz_miss_on_a_fuzzy_word_drops_it_without_a_review(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await rate(client, h, "talk", "fuzzy")
    miss = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice="x")).json()
    assert (miss["applied"], miss["item"]["box"]) == (True, 0)
    hit = (await ans(client, h, key="talk", mode="learn", qtype="word", choice="talk")).json()
    assert (hit["correct"], hit["applied"], hit["item"]["box"]) == (True, False, 0)  # 答对也不回升
    talk = await row(app, "talk")
    assert (talk.reps, talk.last_reviewed_at) == (0, None)


async def test_rerating_the_same_day_only_lowers(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await rate(client, h, "talk", "know")
    down = await rate(client, h, "talk", "unknown")
    assert (down["rating"], down["applied"], down["item"]["box"]) == ("unknown", True, 0)
    up = await rate(client, h, "talk", "know")
    assert (up["applied"], up["item"]["box"]) == (False, 0)
    assert [e[0] for e in await events(app)] == ["learn", "practice", "practice"]
    today = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()
    assert today["plan"]["new_done"] == 1


async def test_known_alias_goes_through_the_spot_check(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_spot_check_pct=100)
    r = (await ans(client, h, key="talk", mode="learn", qtype="meaning", known=True)).json()
    assert (r["outcome"], r["rating"], r["spot_check"], r["item"]["box"]) == ("know", "know", True, 1)
    bad = await ans(client, h, key="talk", mode="review", qtype="meaning", known=True)
    assert bad.status_code == 422


async def test_recall_needs_a_rating(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = await ans(client, h, key="talk", mode="learn", qtype="recall")
    assert r.status_code == 422 and r.json() == {"error": "Rating is required"}
    r = await ans(client, h, key="talk", mode="learn", qtype="recall", rating="maybe")
    assert r.status_code == 422
    r = await ans(client, h, key="talk", mode="learn", qtype="recall", rating="know", elapsed_ms=-1)
    assert r.status_code == 422


async def test_learn_batch_carries_a_word_drill_per_card(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    batch = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 2})).json()
    assert [q["qtype"] for q in batch["drill"]] == ["word", "word"]
    assert [q["key"] for q in batch["drill"]] == [c["key"] for c in batch["cards"]]
    assert "talk" in batch["drill"][0]["options"]


async def test_two_fuzzy_in_a_row_count_as_unknown(app, client, tmp_path, monkeypatch):
    always_recall(monkeypatch)
    h = await login(app, client, tmp_path)
    await rate(client, h, "talk", "fuzzy")
    await make_due(app, "talk")
    second = await rate(client, h, "talk", "fuzzy", mode="review")
    assert (second["rating"], second["grade"], second["item"]["box"]) == ("unknown", "forgot", 0)
    third = await rate(client, h, "talk", "fuzzy", mode="review")  # 未到期;上一条已记为 unknown,不再连续
    assert (third["rating"], third["applied"]) == ("fuzzy", False)


async def test_review_spot_check_is_two_steps(app, client, tmp_path, monkeypatch):
    always_recall(monkeypatch)
    h = await login(app, client, tmp_path, wordbook_spot_check_pct=100)
    await rate(client, h, "talk", "fuzzy")
    await rate(client, h, "ability", "fuzzy")
    for key in ("talk", "ability"):
        await make_due(app, key)
    before = len(await events(app))
    pending = await rate(client, h, "talk", "know", mode="review")
    assert (pending["outcome"], pending["grade"], pending["applied"], pending["spot_check"]) == (
        "pending", None, False, True)
    assert pending["check"]["qtype"] == "meaning" and len(pending["check"]["options"]) == 4
    assert await meaning(app, "talk") in pending["check"]["options"]
    assert len(await events(app)) == before and (await row(app, "talk")).reps == 0  # 不写盒、不记事件
    passed = await rate(client, h, "talk", "know", mode="review", choice=await meaning(app, "talk"))
    assert (passed["outcome"], passed["grade"], passed["item"]["box"]) == ("know", "good", 2)
    assert passed["correct_option"] == await meaning(app, "talk")
    failed = await rate(client, h, "ability", "know", mode="review", choice="x")
    assert (failed["outcome"], failed["rating"], failed["grade"], failed["item"]["box"]) == (
        "unknown", "unknown", "forgot", 0)


async def test_i_was_wrong_after_a_review_lapses_without_reps(app, client, tmp_path, monkeypatch):
    always_recall(monkeypatch)
    h = await login(app, client, tmp_path)
    await rate(client, h, "talk", "fuzzy")
    await make_due(app, "talk")
    await rate(client, h, "talk", "know", mode="review")  # good → 盒 2,reps 1
    oops = await rate(client, h, "talk", "unknown", mode="review")  # 未到期的「不认识」= apply_lapse
    assert (oops["applied"], oops["item"]["box"]) == (True, 0)
    talk = await row(app, "talk")
    assert (talk.reps, talk.lapses) == (1, 1)
    assert [e[0] for e in await events(app)] == ["learn", "review", "practice"]


async def test_rank_points_match_the_events(app, client, tmp_path, monkeypatch):
    """spec recall §6 / INDEX R-P2:每个新词一个 word_learned;当天抽查、小测、再评与复习抽查待答不得分;
    到期复习写入成功(含快速回忆)才有一次 vocab_review。"""
    from app.models import XpEvent
    from app.rank import ledger
    always_recall(monkeypatch)
    h = await login(app, client, tmp_path, wordbook_spot_check_pct=100)
    await rate(client, h, "talk", "know")                                       # know_chk → 盒 1
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=await meaning(app, "talk"))  # 抽查通过
    await rate(client, h, "talk", "unknown")                                    # 记错了:当天只降
    await rate(client, h, "ability", "fuzzy")
    await make_due(app, "ability")
    assert (await rate(client, h, "ability", "know", mode="review"))["outcome"] == "pending"
    await rate(client, h, "ability", "know", mode="review", choice=await meaning(app, "ability"))
    async with app.state.sessionmaker() as s:
        uid = await s.scalar(select(User.id).where(User.username == "alice"))
        await ledger.sync(s, uid, utcnow(), 480, daily_cap=60)
        kinds = sorted((await s.scalars(select(XpEvent.kind).where(
            XpEvent.user_id == uid, XpEvent.kind.in_(("word_learned", "vocab_review"))))).all())
    assert kinds == ["vocab_review", "word_learned", "word_learned"]


# ---- Z2 评审波(review-wordbook-recall.md)----

async def test_concurrent_ratings_for_a_new_word_create_one_row_and_one_learn(app, client, tmp_path):
    """连点 / 并发:同一个新词同时交几次自评,只建一行、只记一次 learn(否则每次多一个 word_learned 段位点)。"""
    import asyncio
    from sqlalchemy import func
    h = await login(app, client, tmp_path)
    rs = await asyncio.gather(*[ans(client, h, key="talk", mode="learn", qtype="recall", rating="know", elapsed_ms=4000)
                                for _ in range(4)])
    assert [r.status_code for r in rs] == [200] * 4
    async with app.state.sessionmaker() as s:
        rows = await s.scalar(select(func.count()).select_from(VocabularyItem).where(VocabularyItem.word == "talk"))
    assert rows == 1
    assert [e[0] for e in await events(app)].count("learn") == 1


async def test_concurrent_v1_answers_for_a_new_word_create_one_row(app, client, tmp_path):
    import asyncio
    from sqlalchemy import func
    h = await login(app, client, tmp_path)
    await asyncio.gather(*[ans(client, h, key="talk", mode="learn", qtype="meaning", choice="x") for _ in range(4)])
    async with app.state.sessionmaker() as s:
        rows = await s.scalar(select(func.count()).select_from(VocabularyItem).where(VocabularyItem.word == "talk"))
    assert rows == 1
    assert [e[0] for e in await events(app)].count("learn") == 1
