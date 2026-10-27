"""简单英英释义的后台改写(计划 2026-10-27 S5):假的 llm.complete,不访问网络。"""
import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models import WordbookSimpleDef
from app.providers import llm
from app.services.prompts import validate_prompt
from app.wordbook import simple_defs_worker as worker
from app.wordbook.simple_defs import SimpleRow, simple_of, src_hash

EASY = frozenset({"make", "less", "a", "state", "of", "to", "cut", "with", "strong", "feeling", "or", "the"})
NOW = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)
ABATE_V = "make less intense"  # hard: intense
ABATE_N = "a state of mind"  # hard: mind
BITE_V = "to cut with teeth"  # hard: teeth


def _no_forms(_form):
    return None


def _configure(app, *, enabled=True, generate=True, daily=0, upstream=True):
    app.state.settings = app.state.settings.model_copy(update={
        "wordbook_simple_defs_enabled": enabled, "wordbook_simple_defs_generate": generate,
        "wordbook_simple_defs_daily": daily, "upstream_llm_base_url": "https://llm.example" if upstream else ""})
    simple = simple_of(app)
    simple.install(easy=EASY, lemmas={"went": "go"}, rows={})
    return simple


def _enqueue(simple, *items):
    for word, pos, text in items:
        simple.queue[(word, pos, src_hash(text))] = (word, pos, text)


class FakeLlm:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = 0

    async def __call__(self, http, settings, messages, *, model, max_tokens, temperature, timeout=60.0):
        self.calls += 1
        reply = self.replies.pop(0) if self.replies else '{"items":[]}'
        if isinstance(reply, Exception):
            raise reply
        return reply


@pytest.fixture
def fake(monkeypatch):
    fake = FakeLlm()
    monkeypatch.setattr(llm, "complete", fake)
    return fake


def _reply(*pairs):
    import json
    return json.dumps({"items": [{"id": i, "text": t} for i, t in pairs]})


async def _rows(app):
    async with app.state.sessionmaker() as session:
        result = await session.execute(select(WordbookSimpleDef).order_by(WordbookSimpleDef.src_hash))
        return [(r.word, r.pos, r.status, r.text, r.attempts, r.retry_after) for r in result.scalars()]


async def test_a_batch_is_one_call_and_its_ok_rows_are_cached(app, fake):
    simple = _configure(app)
    _enqueue(simple, ("abate", "v", ABATE_V), ("abate", "n", ABATE_N))
    fake.replies = [_reply((1, "a state of feeling"), (0, "make less strong"))]
    assert await worker.run_once(app, now=NOW) == 1
    assert fake.calls == 1
    rows = await _rows(app)
    assert ("abate", "n", "ok", "a state of feeling", 0, None) in rows
    assert ("abate", "v", "ok", "make less strong", 0, None) in rows
    assert simple.apply("abate", [{"pos": "v", "text": ABATE_V}, {"pos": "n", "text": ABATE_N}])[0]["text"] == "make less strong"
    assert await worker.run_once(app, now=NOW) == 0 and fake.calls == 1  # the same definition is not sent again


async def test_failed_checks_skip_and_the_original_stays(app, fake):
    simple = _configure(app)
    _enqueue(simple, ("bite", "v", BITE_V))
    fake.replies = [_reply((0, "to cut with mouth"))]  # still one hard word: not fewer than the original
    await worker.run_once(app, now=NOW)
    assert simple.rows[("bite", "v", src_hash(BITE_V))].status == "skip"
    assert ("bite", "v", "skip", None, 0, None) in await _rows(app)


async def test_a_reply_that_is_not_json_fails_the_batch_with_a_retry_time(app, fake):
    simple = _configure(app)
    _enqueue(simple, ("abate", "v", ABATE_V))
    fake.replies = ["Sorry, I cannot help."]
    await worker.run_once(app, now=NOW)
    row = simple.rows[("abate", "v", src_hash(ABATE_V))]
    assert (row.status, row.attempts) == ("failed", 1)
    assert timedelta(minutes=59) <= row.retry_after - NOW <= timedelta(minutes=61)


async def test_an_unavailable_upstream_fails_the_batch_and_pauses_the_worker(app, fake):
    simple = _configure(app)
    _enqueue(simple, ("abate", "v", ABATE_V))
    fake.replies = [llm.LlmUnavailable("network")]
    assert await worker.run_once(app, now=NOW) == 1
    assert simple.rows[("abate", "v", src_hash(ABATE_V))].status == "failed"
    assert await worker.run_once(app, now=NOW) == 0 and fake.calls == 1  # paused for 10 minutes


async def test_the_third_failure_stops_the_automatic_retries(app, fake):
    simple = _configure(app)
    key = ("abate", "v", src_hash(ABATE_V))
    simple.rows[key] = SimpleRow("failed", None, 2, NOW - timedelta(hours=1))
    _enqueue(simple, ("abate", "v", ABATE_V))
    fake.replies = ["not json"]
    await worker.run_once(app, now=NOW)
    assert simple.rows[key].attempts == 3
    assert simple.apply("abate", [{"pos": "v", "text": ABATE_V}], NOW) == [{"pos": "v", "text": ABATE_V}]
    assert key not in simple.queue


async def test_the_daily_cap_stops_the_next_call_and_keeps_the_item_queued(app, fake):
    simple = _configure(app, daily=2)
    fake.replies = [_reply((0, "make less strong")), _reply((0, "a state of feeling")), _reply((0, "make less strong"))]
    for i in range(3):
        _enqueue(simple, (f"abate{i}", "v", ABATE_V))
        worker_now = NOW + timedelta(seconds=i)
        simple.rows.pop(("abate%d" % i, "v", src_hash(ABATE_V)), None)
        if i == 2:
            assert await worker.run_once(app, now=worker_now) == 0
        else:
            assert await worker.run_once(app, now=worker_now) == 1
    assert fake.calls == 2
    assert ("abate2", "v", src_hash(ABATE_V)) in simple.queue


async def test_zero_means_no_daily_limit(app, fake):
    simple = _configure(app, daily=0)
    fake.replies = [_reply((0, "make less strong"))] * 3
    for i in range(3):
        _enqueue(simple, (f"abate{i}", "v", ABATE_V))
        simple.rows.pop(("abate%d" % i, "v", src_hash(ABATE_V)), None)
        assert await worker.run_once(app, now=NOW) == 1
    assert fake.calls == 3


@pytest.mark.parametrize("kwargs", [dict(generate=False), dict(upstream=False), dict(enabled=False)])
async def test_no_generation_when_switched_off_or_unconfigured(app, fake, kwargs):
    simple = _configure(app, **kwargs)
    _enqueue(simple, ("abate", "v", ABATE_V))
    assert await worker.run_once(app, now=NOW) == 0
    assert fake.calls == 0


async def test_logs_carry_counts_only(app, fake, caplog):
    simple = _configure(app)
    _enqueue(simple, ("abate", "v", ABATE_V))
    fake.replies = [_reply((0, "make less strong"))]
    with caplog.at_level(logging.DEBUG, logger="app"):
        await worker.run_once(app, now=NOW)
    text = caplog.text
    assert "abate" not in text and "intense" not in text and "make less strong" not in text
    assert "simple defs batch size=1 ok=1" in text


def test_checks_reject_the_headword_forms_long_text_chinese_brackets_and_non_improvements():
    easy = EASY | {"went"}
    lemma = {"went": "abate"}.get
    assert worker.check_rewrite("make less abate", "abate", ABATE_V, easy=easy, lemma_of=lemma) is None
    assert worker.check_rewrite("make less went", "abate", ABATE_V, easy=easy, lemma_of=lemma) is None
    assert worker.check_rewrite(" ".join(["make"] * 17), "abate", ABATE_V, easy=easy, lemma_of=lemma) is None
    assert worker.check_rewrite("make less 减弱", "abate", ABATE_V, easy=easy, lemma_of=lemma) is None
    assert worker.check_rewrite("<b>make</b> less", "abate", ABATE_V, easy=easy, lemma_of=lemma) is None
    assert worker.check_rewrite("make less intense", "abate", ABATE_V, easy=easy, lemma_of=lemma) is None


def test_the_first_letter_is_lowercased_and_one_trailing_period_dropped():
    easy = EASY
    assert worker.check_rewrite("Make less strong.", "abate", ABATE_V, easy=easy, lemma_of=_no_forms) == "make less strong"
    assert worker.check_rewrite("I make less strong", "abate", ABATE_V, easy=easy, lemma_of=_no_forms) == "I make less strong"


def test_parse_reply_takes_ids_by_number_and_tolerates_a_code_fence():
    reply = '```json\n{"items":[{"id":1,"text":"b"},{"id":0,"text":"a"},{"id":9,"text":"x"},{"id":true,"text":"y"}]}\n```'
    assert worker.parse_reply(reply, 2) == {0: "a", 1: "b"}
    assert worker.parse_reply("nothing here", 2) is None
    assert worker.parse_reply('{"items": "no"}', 2) is None


def test_items_are_escaped_and_a_bad_template_falls_back():
    body = worker.render_items("Rewrite:\n{items}", [("abate", "v", "a <script> thing")])
    assert "<script>" not in body and "‹script›" in body and '<item id=0 word="abate" pos="v">' in body
    assert worker.render_items("no placeholder {bad", [("abate", "v", "x")]).count("<item") == 1


def test_a_published_template_must_carry_the_items_placeholder():
    assert validate_prompt("wordbook.simplify_defs", "Simple English. {items}") == []
    assert validate_prompt("wordbook.simplify_defs", "Simple English only.") != []
