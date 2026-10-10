import random

from sqlalchemy import select

from app.models import VocabularyItem, WordbookEvent, WordbookHiddenSentence, WordbookReport, utcnow
from app.wordbook import store
from app.wordbook.index import dictionary
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
FIVE = ["talk", "ability", "able", "abandon", "absorb"]


async def ready(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    for key in FIVE:
        await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": key, "mode": "learn",
                                                            "qtype": "meaning", "known": True, "tz_offset_minutes": 480})
    return h


async def test_spell_sets_use_today_words_and_hide_answers(app, client, tmp_path):
    h = await ready(app, client, tmp_path)
    body = (await client.post(f"{URL}/spell/sets", headers=h, json={"count": 1, "size": 5, "tz_offset_minutes": 480})).json()
    assert body["book_id"] == "junior"
    (s,) = body["sets"]
    assert sorted(l["key"] for l in s["lines"]) == sorted(FIVE)
    assert all(set(l) == {"key", "sentence_id", "segments", "zh"} for l in s["lines"])
    blanks = [seg for l in s["lines"] for seg in l["segments"] if seg["t"] == "blank"]
    assert sorted(b["i"] for b in blanks) == [0, 1, 2, 3, 4] and all(set(b) == {"t", "i", "len", "form"} for b in blanks)
    text = " ".join(seg.get("v", "") for l in s["lines"] for seg in l["segments"])
    assert "abandon" not in text and "absorb" not in text


async def test_spell_blanks_carry_the_surface_form_for_hint_and_listen(app, client, tmp_path):
    """首字母提示与「听这句」要用句中的实际词形(go → went),不是词头;form 只给这两样用,文本段里仍然没有答案。"""
    h = await ready(app, client, tmp_path)
    await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": "go", "mode": "learn",
                                                        "qtype": "meaning", "known": True, "tz_offset_minutes": 480})
    body = (await client.post(f"{URL}/spell/sets", headers=h, json={"count": 1, "size": 6, "tz_offset_minutes": 480})).json()
    go = next(l for l in body["sets"][0]["lines"] if l["key"] == "go")
    (blank,) = [seg for seg in go["segments"] if seg["t"] == "blank"]
    assert blank["form"] == "went" and blank["len"] == 4
    assert "went" not in "".join(seg.get("v", "") for seg in go["segments"])


async def test_set_out_gives_each_blank_of_a_phrase_its_own_form(tmp_path):
    from app.wordbook.cloze import build_set
    from app.wordbook.index import DictionaryStore
    from app.wordbook.service import set_out
    ds = DictionaryStore(make_data_dir(tmp_path))
    c = await ds.cards("junior", ["used to", "go", "talk"])
    (line_used, line_go, _) = set_out(build_set([c["used to"], c["go"], c["talk"]], size=3))["lines"]
    assert [(b["i"], b["form"]) for b in line_used["segments"] if b["t"] == "blank"] == [(0, "used"), (1, "to")]
    assert [(b["i"], b["form"]) for b in line_go["segments"] if b["t"] == "blank"] == [(2, "went")]


async def test_spell_submit_four_outcomes_and_srs(app, client, tmp_path):
    h = await ready(app, client, tmp_path)
    s = (await client.post(f"{URL}/spell/sets", headers=h, json={"count": 1, "size": 5})).json()["sets"][0]
    typed = {"talk": ("talk", False), "ability": ("abilty", False), "able": ("able", True),
             "abandon": ("abandoned", False), "absorb": ("xyz", False)}
    lines = [{"key": l["key"], "sentence_id": l["sentence_id"],
              "answers": [{"typed": typed[l["key"]][0], "hinted": typed[l["key"]][1]}]} for l in s["lines"]]
    r = await client.post(f"{URL}/spell/submit", headers=h,
                          json={"book_id": "junior", "set_id": s["set_id"], "lines": lines, "tz_offset_minutes": 480})
    body = r.json()
    by = {w["key"]: w for w in body["words"]}
    assert {k: (w["outcome"], w["credit"]) for k, w in by.items()} == {
        "talk": ("correct", 100), "ability": ("typo", 50), "able": ("correct", 50),
        "abandon": ("inflection", 50), "absorb": ("wrong", 0)}
    assert by["ability"]["blanks"][0]["diff"] and by["absorb"]["card"]["word"] == "absorb"
    assert set(by["talk"]["blanks"][0]) == {"i", "outcome", "credit", "typed", "expected", "diff"}
    assert by["absorb"]["item"]["box"] == 0 and by["talk"]["item"]["box"] == 2
    assert (body["credit"], body["counted"]) == (50, False)
    async with app.state.sessionmaker() as sess:
        absorb = (await sess.scalars(select(VocabularyItem).where(VocabularyItem.word == "absorb"))).one()
        talk = (await sess.scalars(select(VocabularyItem).where(VocabularyItem.word == "talk"))).one()
        assert (absorb.box, absorb.lapses) == (0, 1) and (talk.box, talk.reps) == (2, 0)  # 未到期:只有错误改盒
        kinds = (await sess.scalars(select(WordbookEvent.kind).where(WordbookEvent.qtype == "spell_ctx"))).all()
        assert kinds == ["blank"] * 5
        assert "spell_set" not in (await sess.scalars(select(WordbookEvent.kind))).all()


async def test_spell_submit_counts_a_passing_set(app, client, tmp_path):
    h = await ready(app, client, tmp_path)
    s = (await client.post(f"{URL}/spell/sets", headers=h, json={"count": 1, "size": 5})).json()["sets"][0]
    lines = [{"key": l["key"], "sentence_id": l["sentence_id"], "answers": [{"typed": l["key"], "hinted": False}]}
             for l in s["lines"]]
    body = (await client.post(f"{URL}/spell/submit", headers=h, json={"book_id": "junior", "set_id": s["set_id"],
                                                                      "lines": lines})).json()
    assert body["counted"] is True and body["credit"] >= 60
    async with app.state.sessionmaker() as sess:
        assert (await sess.scalars(select(WordbookEvent.kind).where(WordbookEvent.kind == "spell_set"))).all() == ["spell_set"]


async def test_resubmitting_a_set_counts_it_once_per_day(app, client, tmp_path):
    """Review server m1 / web M4: 再练一遍 re-sends the same lines; the server keys the set on its own
    (key, sentence_id) list, not the client's set_id, and counts it once per local day."""
    h = await ready(app, client, tmp_path)
    s = (await client.post(f"{URL}/spell/sets", headers=h, json={"count": 1, "size": 5})).json()["sets"][0]
    lines = [{"key": l["key"], "sentence_id": l["sentence_id"], "answers": [{"typed": l["key"], "hinted": False}]}
             for l in s["lines"]]
    results = []
    for set_id in (s["set_id"], s["set_id"], "forged-id"):
        r = await client.post(f"{URL}/spell/submit", headers=h, json={"book_id": "junior", "set_id": set_id,
                                                                      "lines": lines, "tz_offset_minutes": 480})
        results.append(r.json()["counted"])
    assert results == [True, False, False]
    async with app.state.sessionmaker() as sess:
        rows = (await sess.scalars(select(WordbookEvent.word).where(WordbookEvent.kind == "spell_set"))).all()
    assert rows == [s["set_id"]]


async def test_spell_submit_rejects_changed_sentences(app, client, tmp_path):
    h = await ready(app, client, tmp_path)
    bad = {"book_id": "junior", "set_id": "x", "lines": [{"key": "talk", "sentence_id": "0" * 16,
                                                          "answers": [{"typed": "talk", "hinted": False}]}]}
    r = await client.post(f"{URL}/spell/submit", headers=h, json=bad)
    assert r.status_code == 422 and r.json() == {"error": "Sentence changed"}
    s = (await client.post(f"{URL}/spell/sets", headers=h, json={"count": 1, "size": 3})).json()["sets"][0]
    line = s["lines"][0]
    two = {"book_id": "junior", "set_id": s["set_id"], "lines": [{"key": line["key"], "sentence_id": line["sentence_id"],
                                                                  "answers": [{"typed": "a"}, {"typed": "b"}]}]}
    r = await client.post(f"{URL}/spell/submit", headers=h, json=two)
    assert r.status_code == 422 and r.json() == {"error": "Sentence changed"}  # 空数不对
    async with app.state.sessionmaker() as sess:  # 被屏蔽的句子同样视为已变
        sess.add(WordbookHiddenSentence(sentence_id=line["sentence_id"], book_id="junior", hidden_by="admin",
                                        created_at=utcnow()))
        await sess.commit()
        await store.load_hidden(sess, dictionary(app))
    one = {**two, "lines": [{**two["lines"][0], "answers": [{"typed": "a"}]}]}
    assert (await client.post(f"{URL}/spell/submit", headers=h, json=one)).status_code == 422


async def test_too_few_words_gives_no_sets(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    r = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior"})
    assert (await client.post(f"{URL}/spell/sets", headers=h, json={})).json()["sets"] == []


async def test_spell_sets_are_disjoint(app, client, tmp_path, monkeypatch):
    real = random.Random
    monkeypatch.setattr(random, "Random", lambda seed=0: real(seed))
    h = await ready(app, client, tmp_path)
    for key in ("accept", "accident", "careful"):
        await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": key, "mode": "learn",
                                                            "qtype": "meaning", "known": True})
    sets = (await client.post(f"{URL}/spell/sets", headers=h, json={"count": 4, "size": 3})).json()["sets"]
    keys = [l["key"] for s in sets for l in s["lines"]]
    assert len(sets) >= 2 and len(keys) == len(set(keys))


async def test_card_and_report(app, client, tmp_path, monkeypatch):
    h = await ready(app, client, tmp_path)
    card = (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()
    assert card["word"] == "talk" and len(card["examples"]) == 3
    assert (await client.get(f"{URL}/cards/junior/Talk", headers=h)).json()["key"] == "talk"
    r = await client.get(f"{URL}/cards/junior/nope", headers=h)
    assert r.status_code == 404 and r.json() == {"error": "Word not found"}
    assert (await client.get(f"{URL}/cards/bogus/talk", headers=h)).status_code == 404
    sid = card["examples"][0]["id"]
    r = await client.post(f"{URL}/reports", headers=h, json={"book_id": "junior", "key": "talk", "sentence_id": sid,
                                                             "reason": "wrong"})
    assert r.status_code == 200 and isinstance(r.json()["id"], int)
    async with app.state.sessionmaker() as sess:
        row = (await sess.scalars(select(WordbookReport))).one()
        assert (row.status, row.kind, row.sentence_id, row.word) == ("open", "sentence", sid, "talk")
    bad = await client.post(f"{URL}/reports", headers=h, json={"book_id": "junior", "key": "talk",
                                                               "sentence_id": "0" * 16, "reason": "wrong"})
    assert bad.status_code == 422 and bad.json() == {"error": "Sentence changed"}
    assert (await client.post(f"{URL}/reports", headers=h, json={"book_id": "junior", "key": "talk", "sentence_id": sid,
                                                                 "reason": "spam"})).status_code == 422
    monkeypatch.setattr(store, "REPORTS_DAILY_MAX", 1)
    r = await client.post(f"{URL}/reports", headers=h, json={"book_id": "junior", "key": "talk",
                                                             "sentence_id": card["examples"][1]["id"], "reason": "other"})
    assert r.status_code == 429 and r.json() == {"error": "Daily report limit reached"}


async def test_reporting_the_same_sentence_again_reuses_the_open_report(app, client, tmp_path, monkeypatch):
    """Review m11: one user cannot push a sentence up the admin queue by reporting it repeatedly."""
    h = await ready(app, client, tmp_path)
    sid = (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()["examples"][0]["id"]
    monkeypatch.setattr(store, "REPORTS_DAILY_MAX", 2)
    body = {"book_id": "junior", "key": "talk", "sentence_id": sid, "reason": "wrong"}
    ids = [(await client.post(f"{URL}/reports", headers=h, json=body)).json()["id"] for _ in range(3)]
    assert len(set(ids)) == 1
    async with app.state.sessionmaker() as sess:
        assert len((await sess.scalars(select(WordbookReport))).all()) == 1
    other = (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()["examples"][1]["id"]
    assert (await client.post(f"{URL}/reports", headers=h, json={**body, "sentence_id": other})).status_code == 200
