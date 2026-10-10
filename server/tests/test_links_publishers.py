from pathlib import Path

import pytest

from app.core.learning_events import AssessmentFinished, MessageSent, WordAnswered
from app.services.stats import poor_words, word_buckets
from tests.links_helpers import enable_links
from tests.test_assessment_save import fake, post  # noqa: F401 - pytest fixture re-export
from tests.wordbook_helpers import enable_wordbook, make_data_dir

TALK_MEANING = "v. 说话；谈话；n. 交谈"


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path / "data")}


class Recorder:
    def __init__(self, app, *types):
        self.seen = []
        for t in types:
            app.state.learning_bus.subscribe(t, f"rec_{t.__name__}", self.handle)

    async def handle(self, event):
        self.seen.append(event)


async def login(client, name="alice"):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_wordbook_answer_publishes_one_event_after_commit(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    enable_links(app)
    rec = Recorder(app, WordAnswered)
    h = await login(client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    r = await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "tz_offset_minutes": 480,
                                                                    "key": "talk", "mode": "learn", "qtype": "meaning",
                                                                    "choice": "wrong option"})
    assert r.status_code == 200
    await app.state.learning_bus.drain()
    (e,) = rec.seen
    assert (e.book_id, e.word, e.kind, e.qtype, e.outcome, e.credit) == ("junior", "talk", "learn", "meaning", "wrong", 0)


async def test_publishing_happens_after_the_commit(app, client, tmp_path, monkeypatch):
    """A handler that reads the database sees the committed event row (publish after commit, spec §4.3)."""
    from sqlalchemy import func, select

    from app.models import WordbookEvent
    enable_wordbook(app, make_data_dir(tmp_path))
    enable_links(app)
    counts = []

    async def handler(event):
        async with app.state.sessionmaker() as s:
            counts.append(await s.scalar(select(func.count()).select_from(WordbookEvent)
                                         .where(WordbookEvent.word == event.word)))
    app.state.learning_bus.subscribe(WordAnswered, "rec", handler)
    h = await login(client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "key": "talk", "mode": "learn",
                                                                "qtype": "meaning", "choice": "x"})
    await app.state.learning_bus.drain()
    assert counts == [1]


async def test_master_off_publishes_nothing_and_responses_are_identical(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    rec = Recorder(app, WordAnswered)
    h = await login(client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    body = {"book_id": "junior", "tz_offset_minutes": 480, "key": "talk", "mode": "learn", "qtype": "meaning",
            "choice": TALK_MEANING}
    off = (await client.post("/api/wordbook/answers", headers=h, json=body)).json()
    assert app.state.learning_bus.queue()["size"] == 0 and rec.seen == []
    enable_links(app)
    on = (await client.post("/api/wordbook/answers", headers=h, json={**body, "mode": "review"})).json()
    assert set(off) == set(on)


async def test_a_failing_link_never_fails_the_request(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    enable_links(app)

    async def boom(event):
        raise RuntimeError("handler exploded")
    app.state.learning_bus.subscribe(WordAnswered, "boom", boom)
    h = await login(client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    r = await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "key": "talk", "mode": "learn",
                                                                    "qtype": "meaning", "choice": "x"})
    assert r.status_code == 200
    await app.state.learning_bus.drain()
    assert app.state.learning_bus.stats()["boom"]["failed"] == 1


async def test_spell_submit_publishes_one_event_per_word(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    enable_links(app)
    rec = Recorder(app, WordAnswered)
    h = await login(client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    for key in ("talk", "ability", "able", "accept", "careful", "carry"):
        await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "key": key, "mode": "learn",
                                                                    "qtype": "meaning", "known": True})
    sets = (await client.post("/api/wordbook/spell/sets", headers=h, json={"count": 1, "size": 3})).json()["sets"]
    assert sets, "mini book produced no spelling set"  # 夹具词书至少能组 3 句
    line_answers = [{"key": l["key"], "sentence_id": l["sentence_id"],
                     "answers": [{"typed": "zzz", "hinted": False} for s in l["segments"] if s["t"] == "blank"]}
                    for l in sets[0]["lines"]]
    await app.state.learning_bus.drain()
    rec.seen.clear()
    r = await client.post("/api/wordbook/spell/submit", headers=h,
                          json={"book_id": "junior", "set_id": sets[0]["set_id"], "lines": line_answers})
    assert r.status_code == 200, r.text
    await app.state.learning_bus.drain()
    assert sorted(e.word for e in rec.seen) == sorted(l["key"] for l in line_answers)
    assert all(e.qtype == "spell_ctx" and e.outcome == "wrong" and e.kind in ("blank", "review") for e in rec.seen)


async def test_saved_assessment_publishes_assessment_finished(app, client, fake):  # noqa: F811 - fixture
    enable_links(app)
    rec = Recorder(app, AssessmentFinished)
    h = await login(client)
    r = await post(client, h, save="true")
    assert r.status_code == 200
    await app.state.learning_bus.drain()
    (e,) = rec.seen
    assert e.assessment_id == r.json()["assessment_id"] and e.source == "practice"
    assert isinstance(e.weak_words, tuple) and isinstance(e.good_words, tuple)
    unsaved = await post(client, h)
    assert unsaved.status_code == 200
    await app.state.learning_bus.drain()
    assert len(rec.seen) == 1  # unsaved assessments are not published


async def test_user_messages_publish_message_sent_and_assistant_ones_do_not(app, client):
    enable_links(app)
    rec = Recorder(app, MessageSent)
    h = await login(client)
    conv = (await client.post("/api/conversations", headers=h, json={"name": "c"})).json()
    r = await client.post(f"/api/conversations/{conv['id']}/messages", headers=h, json={"messages": [
        {"role": "user", "content": "I talked a lot"}, {"role": "assistant", "content": "Nice"}]})
    assert r.status_code == 200
    await app.state.learning_bus.drain()
    (e,) = rec.seen
    assert (e.conversation_id, e.message_id, e.text) == (conv["id"], r.json()["messages"][0]["id"], "I talked a lot")


async def test_rating_answers_publish_once_and_pending_checks_do_not(app, client, tmp_path, monkeypatch):
    """INDEX R-E1:A 的三档自评每条作答记录发布一次;复习抽查第一步(pending,不写事件)不发布。"""
    from datetime import timedelta

    from sqlalchemy import update

    from app.models import VocabularyItem, utcnow
    from app.wordbook import service
    enable_wordbook(app, make_data_dir(tmp_path), wordbook_spot_check_pct=100)
    enable_links(app)
    monkeypatch.setattr(service, "use_recall", lambda user_id, key, reps, box: box in (1, 2, 4, 5))
    rec = Recorder(app, WordAnswered)
    h = await login(client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    base = {"book_id": "junior", "tz_offset_minutes": 480, "key": "talk", "qtype": "recall"}
    r = await client.post("/api/wordbook/answers", headers=h, json={**base, "mode": "learn", "rating": "fuzzy"})
    assert r.status_code == 200
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "talk")
                        .values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    pending = (await client.post("/api/wordbook/answers", headers=h,
                                 json={**base, "mode": "review", "rating": "know"})).json()
    assert pending["outcome"] == "pending"
    await client.post("/api/wordbook/answers", headers=h, json={**base, "mode": "review", "rating": "know", "choice": "x"})
    await app.state.learning_bus.drain()
    assert [(e.kind, e.qtype, e.outcome, e.credit) for e in rec.seen] == [
        ("learn", "recall", "fuzzy", 0), ("review", "recall", "unknown", 0)]


def test_word_buckets_agree_with_poor_words():
    fixture = Path(__file__).parent / "fixtures" / "ise_good.xml"
    from app.providers.xfyun_result import to_assessment
    result = to_assessment(fixture.read_text(encoding="utf-8"), "Hello, nice to meet you. I would like a cup of coffee, please.")
    weak, good = word_buckets(result)
    assert {w for w, _ in weak} == poor_words(result)
    assert not {w for w, _ in weak} & set(good)
    crafted = {"detail_result": {"words": [
        {"word": "Three,", "pronunciation_assessment": {"accuracy_score": 40, "error_type": "Mispronunciation"}},
        {"word": "three", "pronunciation_assessment": {"accuracy_score": 30, "error_type": "None"}},
        {"word": "tree", "pronunciation_assessment": {"accuracy_score": 92, "error_type": "None"}},
        {"word": "extra", "pronunciation_assessment": {"accuracy_score": 10, "error_type": "Insertion"}},
        {"word": "okay", "pronunciation_assessment": {"accuracy_score": 70, "error_type": "None"}}]}}
    assert word_buckets(crafted) == ([("three", 30)], ["tree"])
