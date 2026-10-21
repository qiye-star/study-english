"""L4 Task 13: 复习例句端口 ExampleProvider(plan R13、INDEX §4)。字典实现与 quiz.cloze_example 逐字一致;
库实现只取用户自己的句子,且不消耗 question_rng。"""
import random
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.models import LibraryItem, LibrarySegment, SegmentLemma, User
from app.wordbook import examples, quiz
from app.wordbook.examples import Clip, ContextExample, DictionaryExampleProvider, LibraryExampleProvider, provider_for
from app.wordbook.index import DictionaryStore
from tests.wordbook_helpers import make_data_dir

AT = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)
UID = 88888888
OTHER = 88888889
GOOD = "It-good-item-0000-4000-8000-00000001"
TALK_SENTENCE = "I talk to my neighbor every single morning"


@pytest.fixture
async def cards(tmp_path):
    store = DictionaryStore(make_data_dir(tmp_path))
    index = await store.index("junior")
    return index, await store.cards("junior", list(index.keys))


async def add_user(app, uid: int) -> None:
    async with app.state.sessionmaker() as s:
        if await s.get(User, uid) is None:
            s.add(User(id=uid, username=f"ex{uid}", password_hash="x"))
            await s.commit()


async def add_item(app, item_id: str, uid: int, sentences, *, status="ready", low=False) -> None:
    """sentences: list of (text, flags). Every sentence is indexed under the lemma 'talk' (stale rows are
    the caller's problem to create by editing text afterwards)."""
    async with app.state.sessionmaker() as s:
        s.add(LibraryItem(id=item_id, user_id=uid, kind="video", source="upload", title="t", status=status,
                          low_confidence=low, created_at=AT, updated_at=AT))
        for idx, (text, flags) in enumerate(sentences):
            s.add(LibrarySegment(item_id=item_id, idx=idx, start_ms=1000 * idx, end_ms=1000 * idx + 900, text=text,
                                 zh=f"译{idx}", flags=flags))
            s.add(SegmentLemma(scope="lib", owner_id=item_id, idx=idx, lemma="talk"))
        await s.commit()


async def pick(app, card, uid: int = UID, reps: int = 0):
    provider = LibraryExampleProvider()
    async with app.state.sessionmaker() as s:
        return await provider.cloze_example(s, uid, card, reps)


def card_talk(cards):
    index, data = cards
    return data["talk"]


async def test_the_dictionary_provider_is_the_old_cloze_example_on_every_card(cards):
    index, data = cards
    provider = DictionaryExampleProvider()
    checked = 0
    for key, card in data.items():
        expected = quiz.cloze_example(card)
        got = await provider.cloze_example(None, UID, card, 0)
        if expected is None:
            assert got is None, key
            continue
        example, start, end = expected
        assert got == ContextExample(en=example.en, zh=example.zh, start=start, end=end, clip=None), key
        checked += 1
    assert checked >= 1


async def test_a_library_sentence_is_chosen_with_its_clip(app, cards):
    await add_user(app, UID)
    await add_item(app, GOOD, UID, [(TALK_SENTENCE, None)])
    got = await pick(app, card_talk(cards))
    assert got is not None and got.en == TALK_SENTENCE
    assert got.zh == "译0" and got.clip == Clip(item_id=GOOD, start_ms=0, end_ms=900)
    assert (got.start, got.end) == (TALK_SENTENCE.index("talk"), TALK_SENTENCE.index("talk") + 4)


async def test_sentences_outside_six_to_sixteen_words_are_not_chosen(app, cards):
    await add_user(app, UID)
    five = "Let me talk now"  # 4 tokens
    seventeen = " ".join(["word"] * 8 + ["talk"] + ["word"] * 8)  # 17 tokens
    await add_item(app, GOOD, UID, [(five, None), (seventeen, None)])
    got = await pick(app, card_talk(cards))
    assert got is None or got.clip is None  # falls back to the dictionary, never to the user's own rows


async def test_flagged_sentences_are_not_chosen(app, cards):
    await add_user(app, UID)
    await add_item(app, GOOD, UID, [(TALK_SENTENCE, "timing")])
    got = await pick(app, card_talk(cards))
    assert got is None or got.clip is None


async def test_low_confidence_items_are_not_used(app, cards):
    await add_user(app, UID)
    await add_item(app, GOOD, UID, [(TALK_SENTENCE, None)], low=True)
    got = await pick(app, card_talk(cards))
    assert got is None or got.clip is None


async def test_items_that_are_not_ready_are_not_used(app, cards):
    await add_user(app, UID)
    await add_item(app, GOOD, UID, [(TALK_SENTENCE, None)], status="processing")
    got = await pick(app, card_talk(cards))
    assert got is None or got.clip is None


async def test_another_users_items_are_never_used(app, cards):
    await add_user(app, UID)
    await add_user(app, OTHER)
    await add_item(app, GOOD, OTHER, [(TALK_SENTENCE, None)])
    got = await pick(app, card_talk(cards))
    assert got is None or got.clip is None


async def test_an_inflected_form_only_is_not_a_cloze(app, cards):
    await add_user(app, UID)
    await add_item(app, GOOD, UID, [("We talked about it all day long", None)])
    got = await pick(app, card_talk(cards))
    assert got is None or got.clip is None


async def test_a_stale_index_row_is_checked_against_the_text(app, cards):
    await add_user(app, UID)
    await add_item(app, GOOD, UID, [("Nothing to see in this sentence at all", None)])  # index says talk: stale
    got = await pick(app, card_talk(cards))
    assert got is None or got.clip is None


async def test_the_same_inputs_pick_the_same_sentence(app, cards):
    await add_user(app, UID)
    sentences = [(f"Sentence number {i} where I talk about things every day", None) for i in range(4)]
    await add_item(app, GOOD, UID, sentences)
    first = await pick(app, card_talk(cards), reps=2)
    again = await pick(app, card_talk(cards), reps=2)
    assert first == again and first is not None


async def test_the_question_rng_is_not_consumed(app, cards):
    await add_user(app, UID)
    await add_item(app, GOOD, UID, [(TALK_SENTENCE, None), ("Another sentence where I talk a lot daily", None)])
    rng = quiz.question_rng(UID, "talk", 0)
    before = [rng.random() for _ in range(4)]
    await pick(app, card_talk(cards), reps=0)
    fresh = quiz.question_rng(UID, "talk", 0)
    assert [fresh.random() for _ in range(4)] == before


def test_provider_for_uses_the_library_only_when_both_switches_are_on():
    on = SimpleNamespace(activation_enabled=True, library_enabled=True)
    assert isinstance(provider_for(on), LibraryExampleProvider)
    assert isinstance(provider_for(SimpleNamespace(activation_enabled=False, library_enabled=True)),
                      DictionaryExampleProvider)
    assert isinstance(provider_for(SimpleNamespace(activation_enabled=True, library_enabled=False)),
                      DictionaryExampleProvider)
    assert isinstance(provider_for(SimpleNamespace(activation_enabled=False, library_enabled=False)),
                      DictionaryExampleProvider)


def test_the_port_module_does_not_import_library_or_activation():
    import inspect

    source = inspect.getsource(examples)
    assert "app.library" not in source and "app.activation" not in source


# ---- L4 Task 14: the review cloze question may use the learner's own clip (R15, R16) ----

URL = "/api/wordbook"


def _example(start: int = 2, end: int = 6) -> ContextExample:
    return ContextExample(en=TALK_SENTENCE, zh="我每天早上跟邻居聊天。", start=start, end=end,
                          clip=Clip(item_id=GOOD, start_ms=1000, end_ms=4000))


def test_a_library_example_keeps_the_options_and_their_order(cards):
    from app.wordbook import service

    index, data = cards
    card = data["talk"]
    pool = list(data.values())
    rng_a = quiz.question_rng(UID, "talk", 0)
    base = quiz.build_question("cloze", card, quiz.pick_distractors(card, pool, "cloze", rng_a), rng_a)
    rng_b = quiz.question_rng(UID, "talk", 0)
    with_ex = quiz.build_question("cloze", card, quiz.pick_distractors(card, pool, "cloze", rng_b), rng_b,
                                  example=_example())
    assert with_ex.options == base.options
    assert with_ex.prompt == {"sentence": "I _____ to my neighbor every single morning",
                              "zh": "我每天早上跟邻居聊天。"}
    assert with_ex.clip == Clip(item_id=GOOD, start_ms=1000, end_ms=4000)
    assert base.clip is None
    assert service.question_out(with_ex)["clip"] == {"item_id": GOOD, "start_ms": 1000, "end_ms": 4000}
    assert "clip" not in service.question_out(base)  # the key appears only when there is a clip


async def test_review_batch_uses_the_clip_only_with_both_switches_on(app, client, tmp_path, monkeypatch):
    from app.models import LibraryItem, LibrarySegment, SegmentLemma, utcnow
    from tests.links_helpers import user_id_of
    from tests.test_wordbook_learn import ans, login, make_due, pin_qtypes

    h = await login(app, client, tmp_path, library_enabled=True, activation_enabled=True)
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice="v. 说话；谈话；n. 交谈")
    await make_due(app, "talk")
    pin_qtypes(monkeypatch, {"talk": "cloze"})
    uid = await user_id_of(client, h)
    async with app.state.sessionmaker() as s:
        s.add(LibraryItem(id=GOOD, user_id=uid, kind="video", source="upload", title="t", status="ready",
                          low_confidence=False, created_at=utcnow(), updated_at=utcnow()))
        s.add(LibrarySegment(item_id=GOOD, idx=0, start_ms=1000, end_ms=4000, text=TALK_SENTENCE, zh="译", flags=None))
        s.add(SegmentLemma(scope="lib", owner_id=GOOD, idx=0, lemma="talk"))
        await s.commit()
    on = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5, "tz_offset_minutes": 480})).json()
    talk = next(q for q in on["questions"] if q["key"] == "talk")
    assert talk["qtype"] == "cloze" and talk["prompt"]["sentence"].startswith("I _____ to my neighbor")
    assert talk["clip"] == {"item_id": GOOD, "start_ms": 1000, "end_ms": 4000}

    app.state.settings = app.state.settings.model_copy(update={"activation_enabled": False})
    off = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5, "tz_offset_minutes": 480})).json()
    talk_off = next(q for q in off["questions"] if q["key"] == "talk")
    assert "clip" not in talk_off
    assert not talk_off["prompt"]["sentence"].startswith("I _____ to my neighbor")
