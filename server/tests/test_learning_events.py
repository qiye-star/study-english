import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.core import learning_events as le
from app.core.learning_events import AssessmentFinished, LearningBus, MessageSent, WeakWord, WordAnswered

AT = datetime(2026, 10, 11, 8, 0, tzinfo=timezone.utc)


def settings(**kw):
    base = dict(links_enabled=True, links_queue_max=1000, links_handler_timeout_ms=2000,
                links_breaker_failures=3, links_breaker_cooldown_seconds=60)
    return SimpleNamespace(**{**base, **kw})


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def answered(user_id=1, word="talk", outcome="wrong"):
    return WordAnswered(user_id=user_id, book_id="junior", word=word, kind="review", qtype="meaning",
                        outcome=outcome, credit=0, at=AT)


def make_bus(**kw):
    box = {"s": settings(**kw)}
    clock = Clock()
    return LearningBus(lambda: box["s"], clock=clock), box, clock


async def noop(event):
    return None


async def test_master_switch_off_publishes_nothing():
    bus, _, _ = make_bus(links_enabled=False)
    seen = []

    async def handler(e):
        seen.append(e)
    bus.subscribe(WordAnswered, "mistakes", handler)
    assert bus.publish(answered()) is False
    assert await bus.drain() == 0 and seen == []
    assert bus.stats()["mistakes"]["published"] == 0


async def test_events_without_subscribers_are_not_queued():
    bus, _, _ = make_bus()
    bus.subscribe(MessageSent, "chat_words", noop)
    assert bus.publish(answered()) is False
    assert bus.queue()["size"] == 0


def test_unknown_event_types_cannot_be_subscribed():
    bus, _, _ = make_bus()
    with pytest.raises(ValueError):
        bus.subscribe(dict, "x", noop)


async def test_order_and_isolation_between_links():
    bus, _, _ = make_bus()
    seen = []

    async def boom(e):
        raise RuntimeError(f"secret {e.word}")

    async def ok(e):
        seen.append(e.word)
    bus.subscribe(WordAnswered, "a", boom)
    bus.subscribe(WordAnswered, "b", ok)
    for w in ("one", "two"):
        assert bus.publish(answered(word=w)) is True
    assert await bus.drain() == 2
    assert seen == ["one", "two"]
    stats = bus.stats()
    assert (stats["a"]["failed"], stats["a"]["published"], stats["b"]["handled"]) == (2, 2, 2)
    first = bus.recent_errors()[0]
    assert {k: first[k] for k in ("link", "event", "error")} == {"link": "a", "event": "WordAnswered", "error": "RuntimeError"}
    assert set(first) == {"at", "link", "event", "error"}


async def test_timeout_is_counted_and_does_not_block_the_next_link():
    bus, _, _ = make_bus(links_handler_timeout_ms=100)
    seen = []

    async def slow(e):
        await asyncio.sleep(5)

    async def ok(e):
        seen.append(1)
    bus.subscribe(WordAnswered, "slow", slow)
    bus.subscribe(WordAnswered, "ok", ok)
    bus.publish(answered())
    await bus.drain()
    assert bus.stats()["slow"]["timeouts"] == 1 and seen == [1]


async def test_queue_limit_drops_counts_and_is_hot():
    bus, box, _ = make_bus(links_queue_max=2)
    bus.subscribe(WordAnswered, "m", noop)
    assert [bus.publish(answered()) for _ in range(3)] == [True, True, False]
    assert bus.queue() == {"size": 2, "max": 2, "dropped": 1}
    assert bus.stats()["m"]["dropped"] == 1
    box["s"] = settings(links_queue_max=5)
    assert bus.publish(answered()) is True


async def test_breaker_opens_cools_down_half_opens_and_closes():
    bus, _, clock = make_bus(links_breaker_failures=2, links_breaker_cooldown_seconds=60)
    calls, fail = [], {"on": True}

    async def handler(e):
        calls.append(1)
        if fail["on"]:
            raise ValueError()
    bus.subscribe(WordAnswered, "m", handler)
    for _ in range(3):
        bus.publish(answered())
    await bus.drain()
    s = bus.stats()["m"]
    assert (len(calls), s["failed"], s["breaker_skipped"], s["breaker"], s["breaker_opens"]) == (2, 2, 1, "open", 1)
    clock.t += 61
    assert bus.stats()["m"]["breaker"] == "half_open"
    bus.publish(answered())
    await bus.drain()  # a failure while half-open reopens at once
    assert (bus.stats()["m"]["breaker"], bus.stats()["m"]["breaker_opens"]) == ("open", 2)
    clock.t += 61
    fail["on"] = False
    bus.publish(answered())
    await bus.drain()
    assert (bus.stats()["m"]["breaker"], bus.stats()["m"]["handled"]) == ("closed", 1)


async def test_reset_breaker():
    bus, _, _ = make_bus(links_breaker_failures=1)

    async def boom(e):
        raise ValueError()
    bus.subscribe(WordAnswered, "m", boom)
    bus.publish(answered())
    await bus.drain()
    assert bus.stats()["m"]["breaker"] == "open"
    assert bus.reset_breaker("m") is True and bus.stats()["m"]["breaker"] == "closed"
    assert bus.reset_breaker("nope") is False


async def test_gate_skips_per_link_and_user_and_a_broken_gate_is_a_failure():
    bus, _, _ = make_bus()
    seen = []

    async def handler(e):
        seen.append(e.user_id)

    async def gate(link, user_id):
        if user_id == 3:
            raise RuntimeError("db down")
        return user_id != 2
    bus.subscribe(WordAnswered, "m", handler)
    bus.set_gate(gate)
    for uid in (1, 2, 3):
        bus.publish(answered(user_id=uid))
    await bus.drain()
    s = bus.stats()["m"]
    assert seen == [1] and (s["skipped"], s["failed"]) == (1, 1)


async def test_extra_counters():
    bus, _, _ = make_bus()
    bus.subscribe(MessageSent, "chat_words", noop)
    bus.count("chat_words", "llm_degraded")
    bus.count("chat_words", "llm_degraded", 2)
    assert bus.stats()["chat_words"]["extra"] == {"llm_degraded": 3}


async def test_module_publish_needs_a_bound_bus_and_bindings_do_not_leak():
    bus, _, _ = make_bus()
    bus.subscribe(MessageSent, "c", noop)
    ev = MessageSent(user_id=1, conversation_id="c1", message_id="m1", text="hello", at=AT)

    async def unbound():
        return le.publish(ev)

    async def bound():
        le.bind(bus)
        return le.publish(ev)
    assert await asyncio.create_task(unbound()) is False
    assert await asyncio.create_task(bound()) is True
    assert await asyncio.create_task(unbound()) is False


async def test_publish_never_raises():
    bus, _, _ = make_bus()

    def broken():
        raise RuntimeError("settings exploded")
    bus._settings = broken

    async def run():
        le.bind(bus)
        return le.publish(answered())
    assert await asyncio.create_task(run()) is False


async def test_run_loop_processes_published_events_and_stops_on_cancel():
    bus, _, _ = make_bus()
    seen = asyncio.Event()

    async def handler(e):
        seen.set()
    bus.subscribe(WordAnswered, "m", handler)
    task = asyncio.create_task(bus.run())
    await asyncio.sleep(0)
    bus.publish(answered())
    await asyncio.wait_for(seen.wait(), 1.0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert bus.stats()["m"]["handled"] == 1


def test_fields_are_truncated_and_text_is_not_in_repr():
    ev = MessageSent(user_id=1, conversation_id="c", message_id="m", text="x" * 5000, at=AT)
    assert len(ev.text) == 4000 and "xxxx" not in repr(ev)
    a = AssessmentFinished(user_id=1, assessment_id="a", source="practice", score=50,
                           weak_words=[WeakWord(f"w{i}", 10) for i in range(40)],
                           good_words=[f"g{i}" for i in range(70)], at=AT)
    assert (len(a.weak_words), len(a.good_words)) == (32, 64)
    assert isinstance(a.weak_words, tuple) and isinstance(a.good_words, tuple)
    assert len(answered(word="y" * 300).word) == 100 and len(answered().event_id) == 32


async def test_failures_never_log_text_words_or_messages(caplog):
    bus, _, _ = make_bus()

    async def boom(e):
        raise RuntimeError(f"bad {e.text}")
    bus.subscribe(MessageSent, "c", boom)
    bus.publish(MessageSent(user_id=7, conversation_id="c", message_id="m", text="my secret sentence", at=AT))
    with caplog.at_level("WARNING", logger="app.core.learning_events"):
        await bus.drain()
    assert "links failure link=c event=MessageSent error=RuntimeError" in caplog.text
    assert "secret" not in caplog.text and "bad" not in caplog.text


async def test_one_user_cannot_crowd_other_users_out_of_the_queue():
    """Review Z2: the queue is shared by everyone; a single user's burst (e.g. many chat messages) must not make
    other users' events drop. Each user may hold at most max(10, queue_max // 10) queued events."""
    bus, _, _ = make_bus(links_queue_max=100)
    seen = []

    async def handler(e):
        seen.append(e.user_id)
    bus.subscribe(WordAnswered, "m", handler)
    flood = [bus.publish(answered(user_id=1)) for _ in range(50)]
    assert flood.count(True) == 10 and bus.queue()["dropped"] == 40
    assert bus.publish(answered(user_id=2)) is True
    assert bus.stats()["m"]["dropped"] == 40
    await bus.drain()
    assert seen.count(1) == 10 and seen.count(2) == 1
    assert bus.publish(answered(user_id=1)) is True  # the share frees up as the queue drains


async def test_a_hanging_gate_times_out_instead_of_blocking_the_consumer():
    bus, _, _ = make_bus(links_handler_timeout_ms=100)
    seen = []

    async def handler(e):
        seen.append(e.user_id)

    async def gate(link, user_id):
        if link == "slow":
            await asyncio.sleep(3600)
        return True
    bus.subscribe(WordAnswered, "slow", handler)
    bus.subscribe(WordAnswered, "fast", handler)
    bus.set_gate(gate)
    bus.publish(answered())
    await asyncio.wait_for(bus.drain(), 2)
    assert seen == [1] and bus.stats()["slow"]["timeouts"] == 1 and bus.stats()["fast"]["handled"] == 1
