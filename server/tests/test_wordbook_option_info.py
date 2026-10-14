"""答题后的选项信息(计划 2026-10-13-review-after-answer S2):option_info / phrases / example(R-A1 … R-A6)。"""
from datetime import timedelta

from sqlalchemy import update

from app.models import VocabularyItem, utcnow
from app.wordbook import service
from app.wordbook.entry import meaning_line
from app.wordbook.index import dictionary
from tests.wordbook_helpers import enable_wordbook, make_data_dir, make_defs_dir

URL = "/api/wordbook"
TALK_MEANING = "v. 说话；谈话；n. 交谈"
EXTRA_KEYS = {"option_info", "phrases", "example"}


async def login(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    make_defs_dir(tmp_path)  # 英文释义:option_info 的 defs_en 来自它
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h


async def ans(client, h, **body):
    return await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "tz_offset_minutes": 480, **body})


async def learn_batch(client, h) -> dict:
    return (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 5})).json()


async def test_a_meaning_answer_names_the_word_behind_every_option(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    talk = next(q for q in (await learn_batch(client, h))["quiz"] if q["key"] == "talk")
    wrong = next(o for o in talk["options"] if o != TALK_MEANING)
    body = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=wrong)).json()
    assert (body["correct"], body["expected"], body["correct_option"]) == (False, "talk", TALK_MEANING)  # 旧字段不变
    info = body["option_info"]
    assert [i["option"] for i in info] == talk["options"]  # 与题面同序
    assert all(set(i) == {"option", "word", "defs_zh", "defs_en"} for i in info)
    by_option = {i["option"]: i for i in info}
    assert by_option[TALK_MEANING]["word"] == "talk"
    # 夹具里 talk / Talk 合并后还有第三条 n/v 释义(计划只写了前两条),所以只比前两条
    assert by_option[TALK_MEANING]["defs_zh"][:2] == [{"pos": "v", "text": "说话；谈话"}, {"pos": "n", "text": "交谈"}]
    assert by_option[TALK_MEANING]["defs_en"][0] == {"pos": "v", "text": "speak to someone"}
    assert len({i["word"] for i in info}) == len(info) == 4
    store = dictionary(app)
    for i in info:  # 每个 word 确实是这条释义行的主人
        assert meaning_line(await store.card("junior", i["word"].lower())) == i["option"]


async def test_phrases_and_example_come_from_the_correct_word_card(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_batch(client, h)
    body = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)).json()
    card = (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()
    assert body["phrases"] == card["phrases"][:3] and body["phrases"] == [{"en": "talk about", "zh": "谈论某事"}]
    assert body["example"] == card["examples"][0] and set(body["example"]) == {"id", "en", "zh"}


async def test_a_word_answer_names_the_word_of_every_option(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    drill = next(q for q in (await learn_batch(client, h))["drill"] if q["key"] == "ability")
    wrong = next(o for o in drill["options"] if o != "ability")
    body = (await ans(client, h, key="ability", mode="learn", qtype="word", choice=wrong)).json()
    info = body["option_info"]
    assert [i["option"] for i in info] == drill["options"] and [i["word"] for i in info] == drill["options"]
    ability = next(i for i in info if i["option"] == "ability")
    assert ability["defs_zh"] == [{"pos": "n", "text": "能力，能耐；才能"}]
    assert ability["defs_en"] == [{"pos": "n", "text": "the power or skill to do something"}]
    assert all(i["defs_zh"] for i in info)


async def test_typed_and_rating_answers_keep_the_old_shape(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_batch(client, h)
    typed = (await ans(client, h, key="ability", mode="learn", qtype="spell", typed="ability")).json()
    rated = (await ans(client, h, key="able", mode="learn", qtype="recall", rating="know")).json()
    for body in (typed, rated):
        assert not EXTRA_KEYS & set(body)


async def test_without_a_memo_the_answer_degrades_to_the_old_option_shape(app, client, tmp_path):
    """进程重启 / 淘汰:没有 option_info,但 phrases / example 来自词卡,仍在。"""
    h = await login(app, client, tmp_path)
    await learn_batch(client, h)
    dictionary(app).option_memo.clear()
    body = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)).json()
    assert "option_info" not in body and body["phrases"] and body["example"]
    assert body["correct"] is True and body["correct_option"] == TALK_MEANING


async def test_a_choice_that_is_not_in_the_remembered_options_gets_no_option_info(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_batch(client, h)
    body = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice="not an option")).json()
    assert body["correct"] is False and "option_info" not in body


async def test_review_questions_remember_their_options(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(service, "pick_qtype", lambda box, card, rng, *, tts=True: "meaning")
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "talk")
                        .values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    (q,) = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5, "tz_offset_minutes": 480})).json()["questions"]
    assert q["qtype"] == "meaning" and TALK_MEANING in q["options"]
    wrong = next(o for o in q["options"] if o != TALK_MEANING)
    body = (await ans(client, h, key="talk", mode="review", qtype="meaning", choice=wrong)).json()
    assert [i["option"] for i in body["option_info"]] == q["options"]
    assert next(i for i in body["option_info"] if i["option"] == TALK_MEANING)["word"] == "talk"


async def test_free_review_questions_remember_their_options(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(service, "free_choice_qtype", lambda card, rng: "meaning")
    for key in ("talk", "ability", "able"):
        await ans(client, h, key=key, mode="learn", qtype="recall", rating="know")
    free = (await client.post(f"{URL}/free/start", headers=h, json={
        "scope": "all", "mode": "choice", "count": 10, "tz_offset_minutes": 480})).json()
    item = free["items"][0]
    q = item["question"]
    right = meaning_line(await dictionary(app).card(item["book_id"], item["card"]["key"]))
    wrong = next(o for o in q["options"] if o != right)
    body = (await ans(client, h, book_id=item["book_id"], key=item["card"]["key"], mode="free", qtype="meaning",
                      choice=wrong)).json()
    assert [i["option"] for i in body["option_info"]] == q["options"]
    assert {i["word"] for i in body["option_info"]} >= {item["card"]["word"]}


async def test_option_info_is_not_logged(app, client, tmp_path, caplog):
    caplog.set_level("DEBUG")
    h = await login(app, client, tmp_path)
    await learn_batch(client, h)
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)
    assert "speak to someone" not in caplog.text and "谈论某事" not in caplog.text


async def _cloze_review_question(app, client, h, monkeypatch) -> dict:
    monkeypatch.setattr(service, "pick_qtype", lambda box, card, rng, *, tts=True: "cloze")
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "talk")
                        .values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    (q,) = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5, "tz_offset_minutes": 480})).json()["questions"]
    assert q["qtype"] == "cloze"
    return q


async def test_a_cloze_answer_names_the_word_of_every_option(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    q = await _cloze_review_question(app, client, h, monkeypatch)
    wrong = next(o for o in q["options"] if o != "talk")
    body = (await ans(client, h, key="talk", mode="review", qtype="cloze", choice=wrong)).json()
    assert (body["correct"], body["correct_option"]) == (False, "talk")
    info = body["option_info"]
    assert [i["option"] for i in info] == q["options"] == [i["word"] for i in info]
    assert all(set(i) == {"option", "word", "defs_zh", "defs_en"} and i["defs_zh"] for i in info)
    assert body["phrases"] and body["example"]


async def test_a_cloze_answer_without_a_memo_has_no_option_info(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    await _cloze_review_question(app, client, h, monkeypatch)
    dictionary(app).option_memo.clear()
    body = (await ans(client, h, key="talk", mode="review", qtype="cloze", choice="talk")).json()
    assert "option_info" not in body and body["correct"] is True
