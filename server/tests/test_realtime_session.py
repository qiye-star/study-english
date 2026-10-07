import asyncio
import json
import struct

import pytest

from app import realtime_session
from app.asr import AsrError
from app.realtime_session import (
    ConversationGoneError, LlmError, MessageLimitError, RealtimeLimits, RealtimeSession, TtsError, Upstreams,
)

PCM = b"\x01\x00" * 1600  # 100 ms


class FakeRecognizer:
    def __init__(self, text="hello there", error=None, gate=None, send_error=None):
        self.text, self.error, self.gate, self.send_error = text, error, gate, send_error
        self.audio = bytearray()
        self.aborted = False
        self.finished = False

    async def send_audio(self, pcm):
        if self.send_error:
            raise self.send_error
        self.audio += pcm

    async def finish(self):
        if self.gate:
            await self.gate.wait()
        if self.error:
            raise self.error
        self.finished = True
        return self.text

    async def abort(self):
        self.aborted = True


class Factory:
    def __init__(self, *recognizers, open_error=None):
        self.recognizers = list(recognizers)
        self.open_error = open_error
        self.opened = 0
        self.made: list[FakeRecognizer] = []

    async def __call__(self, on_partial):
        self.opened += 1
        if self.open_error:
            raise self.open_error
        await on_partial("hel")
        r = self.recognizers.pop(0) if self.recognizers else FakeRecognizer()
        self.made.append(r)
        return r


class FakeStore:
    def __init__(self, limit_error=False, user_error=None, assistant_error=None):
        self.messages: list[dict] = []
        self.limit_error = limit_error
        self.user_error = user_error
        self.assistant_error = assistant_error

    async def history(self, limit):
        return [{"role": m["role"], "content": m["content"]} for m in self.messages][-limit:]

    async def add_user(self, text):
        if self.limit_error:
            raise MessageLimitError()
        if self.user_error:
            raise self.user_error
        self.messages.append({"role": "user", "content": text})
        return f"m{len(self.messages)}"

    async def add_assistant(self, text):
        if self.assistant_error:
            raise self.assistant_error
        self.messages.append({"role": "assistant", "content": text})
        return f"m{len(self.messages)}"


def llm_of(*deltas, error=None, seen=None, hang=False, closed=None):
    async def stream(messages):
        if seen is not None:
            seen.append(messages)
        try:
            for d in deltas:
                await asyncio.sleep(0)
                yield d
            if hang:
                await asyncio.Event().wait()
            if error:
                raise error
        finally:
            if closed is not None:
                closed.append(True)
    return stream


def tts_of(gate_after=None, error_on=None, log=None, error=TtsError):
    async def stream(text):
        if log is not None:
            log.append(text)
        if error_on and error_on in text:
            raise error()
        if gate_after and gate_after in text:
            await asyncio.Event().wait()  # 永远等待:只能被取消
        yield b"\x02\x00" * 240
    return stream


class Harness:
    def __init__(self, *, factory=None, fallback=None, llm=None, tts=None, store=None, assessor=None,
                 allow=True, limits=RealtimeLimits(max_seconds=5, idle_seconds=2), clock=None,
                 send_json=None, send_bytes=None):
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.events: list[dict] = []
        self.audio: list[bytes] = []
        self.log: list[tuple] = []
        self.store = store or FakeStore()
        self.factory = factory or Factory()
        self.allow = allow
        extra = {"clock": clock} if clock is not None else {}
        self.session = RealtimeSession(
            upstreams=Upstreams(self.factory, fallback, "buffered", llm or llm_of("Sure. ", "What size?"), tts or tts_of(), assessor),
            store=self.store, system_prompt="Be a barista.", allow_turn=lambda: self.allow() if callable(self.allow) else self.allow,
            send_json=send_json or self._json, send_bytes=send_bytes or self._bytes, limits=limits, **extra,
        )

    async def _json(self, e):
        self.events.append(e)
        self.log.append(("json", e))

    async def _bytes(self, b):
        self.audio.append(b)
        self.log.append(("audio", struct.unpack(">I", b[:4])[0]))

    def send(self, item):
        self.inbox.put_nowait(json.dumps(item) if isinstance(item, dict) else item)

    async def run(self):
        return await self.session.run(self.inbox.get)

    def types(self):
        return [e["type"] for e in self.events]

    def of(self, kind):
        return [e for e in self.events if e["type"] == kind]

    async def until(self, predicate, timeout=2.0):
        async with asyncio.timeout(timeout):
            while not predicate():
                await asyncio.sleep(0.005)


async def speak_once(h: Harness):
    h.send(PCM)
    h.send({"type": "utterance_end"})


async def test_one_full_turn_saves_both_messages_and_streams_audio():
    h = Harness()
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert h.events[0] == {"type": "ready", "asr": "buffered"}
    final = next(e for e in h.events if e["type"] == "transcript_final")
    assert final == {"type": "transcript_final", "text": "hello there", "message_id": "m1"}
    assert {"type": "transcript_partial", "text": "hel"} in h.events
    done = next(e for e in h.events if e["type"] == "reply_done")
    assert done == {"type": "reply_done", "turn_id": 1, "message_id": "m2", "interrupted": False}
    assert [m["content"] for m in h.store.messages] == ["hello there", "Sure. What size?"]
    assert h.audio and all(struct.unpack(">I", a[:4])[0] == 1 for a in h.audio)
    states = [e["state"] for e in h.events if e["type"] == "state"]
    assert states == ["listening", "thinking", "speaking", "listening"]
    assert h.session.stats.turns == 1


async def test_llm_gets_the_system_prompt_and_history():
    seen = []
    h = Harness(llm=llm_of("Hi.", seen=seen))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    assert seen[0] == [{"role": "system", "content": "Be a barista."}, {"role": "user", "content": "hello there"}]


async def test_empty_transcript_is_not_saved_or_answered():
    h = Harness(factory=Factory(FakeRecognizer(text="  ")))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "transcript_final" in h.types())
    h.send({"type": "hangup"})
    await task
    assert next(e for e in h.events if e["type"] == "transcript_final")["message_id"] is None
    assert h.store.messages == [] and "reply_delta" not in h.types()


@pytest.mark.parametrize("how", ["interrupt", "audio"])
async def test_interrupt_cancels_and_saves_only_the_spoken_part(how):
    log = []
    h = Harness(llm=llm_of("One. ", "Two. ", "Three."), tts=tts_of(gate_after="Two", log=log))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "Two." in log)
    h.send({"type": "interrupt"} if how == "interrupt" else PCM)
    await h.until(lambda: "reply_done" in h.types())
    done = next(e for e in h.events if e["type"] == "reply_done")
    assert done["interrupted"] is True and done["message_id"] == "m2"
    assert h.store.messages[1] == {"role": "assistant", "content": "One. …"}
    assert "Three." not in log
    assert h.session.stats.interrupts == 1
    h.send({"type": "hangup"})
    assert await task == 1000


async def test_interrupt_while_recognising_keeps_the_first_utterance_without_a_reply():
    gate = asyncio.Event()
    seen = []
    h = Harness(factory=Factory(FakeRecognizer("first part", gate=gate), FakeRecognizer("second part")), llm=llm_of("OK.", seen=seen))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: h.factory.opened == 1 and "state" in h.types() and h.events[-1].get("state") == "thinking")
    await speak_once(h)  # 新的语音到达:第一句不回复
    await h.until(lambda: h.factory.opened == 2)  # 服务端已处理新的语音,再放行第一句的识别
    gate.set()
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    assert [m["content"] for m in h.store.messages] == ["first part", "second part", "OK."]
    assert len(seen) == 1 and [m["content"] for m in seen[0][1:]] == ["first part", "second part"]


async def test_idle_timeout_closes_4008():
    h = Harness(limits=RealtimeLimits(max_seconds=5, idle_seconds=0.15))
    assert await asyncio.wait_for(h.run(), 2) == 4008


async def test_idle_is_not_counted_while_the_bot_speaks():
    async def slow_tts(text):
        await asyncio.sleep(0.3)
        yield b"\x00\x00"
    h = Harness(tts=slow_tts, limits=RealtimeLimits(max_seconds=5, idle_seconds=0.2))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    assert await asyncio.wait_for(task, 3) == 4008
    assert "reply_done" in h.types()  # 说完之后才因静音挂断


async def test_max_duration_closes_4009():
    h = Harness(limits=RealtimeLimits(max_seconds=0.2, idle_seconds=10))
    task = asyncio.create_task(h.run())
    for _ in range(10):
        h.send(PCM)
        await asyncio.sleep(0.03)
    assert await asyncio.wait_for(task, 2) == 4009


async def test_rate_limited_turn_is_reported_and_skipped():
    h = Harness(allow=False)
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "error" in h.types())
    h.send({"type": "hangup"})
    await task
    assert {"type": "error", "code": "rate_limited"} in h.events and h.store.messages == []


async def test_message_limit_closes_4013():
    h = Harness(store=FakeStore(limit_error=True))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    assert await asyncio.wait_for(task, 2) == 4013
    assert {"type": "error", "code": "message_limit"} in h.events


async def test_stream_asr_failure_degrades_to_the_fallback():
    fallback = Factory(FakeRecognizer("from fallback"))
    h = Harness(factory=Factory(open_error=AsrError("upstream")), fallback=fallback)
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    assert {"type": "degraded", "reason": "asr"} in h.events
    assert h.store.messages[0]["content"] == "from fallback"


async def test_asr_unavailable_without_fallback_closes_4502():
    h = Harness(factory=Factory(open_error=AsrError("auth")))
    task = asyncio.create_task(h.run())
    h.send(PCM)
    assert await asyncio.wait_for(task, 2) == 4502


async def test_recognition_failure_reports_and_keeps_listening():
    h = Harness(factory=Factory(FakeRecognizer(error=AsrError("upstream"))))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "error" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert {"type": "error", "code": "asr_failed"} in h.events


async def test_llm_failure_reports_and_saves_nothing_for_the_reply():
    h = Harness(llm=llm_of(error=LlmError()))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: {"type": "error", "code": "llm_failed"} in h.events)
    h.send({"type": "hangup"})
    await task
    assert [m["role"] for m in h.store.messages] == ["user"]
    assert {"type": "reply_done", "turn_id": 1, "message_id": None, "interrupted": True} in h.events
    assert h.events[-1:] == [{"type": "state", "state": "listening"}]


async def test_tts_failure_keeps_the_text_reply():
    h = Harness(tts=tts_of(error_on="Sure"))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    assert {"type": "error", "code": "tts_failed"} in h.events
    assert h.store.messages[-1]["content"] == "Sure. What size?"


async def test_assessment_events_and_failures():
    class Assessor:
        def __init__(self):
            self.calls = []

        async def assess(self, message_id, pcm, text):
            self.calls.append((message_id, len(pcm), text))
            if len(self.calls) > 1:
                raise RuntimeError("boom")
            return {"status": "done", "result": {"pronunciation_score": 80}, "assessment_id": None}

    a = Assessor()
    h = Harness(assessor=a, factory=Factory(FakeRecognizer("one"), FakeRecognizer("two")))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "assessment" in h.types())
    await h.until(lambda: "reply_done" in h.types())
    await speak_once(h)
    await h.until(lambda: len([e for e in h.events if e["type"] == "assessment"]) == 2)
    h.send({"type": "hangup"})
    await task
    await h.session.drain()
    first, second = [e for e in h.events if e["type"] == "assessment"]
    assert first["message_id"] == "m1" and first["status"] == "done"
    assert second == {"type": "assessment", "message_id": "m3", "status": "failed"}
    assert a.calls[0] == ("m1", len(PCM), "one")


@pytest.mark.parametrize("bad", ["not json", {"type": "start", "voice": "abc"}, b"\x00" * 3, b"\x00" * 40000],
                         ids=["not-json", "second-start", "odd-frame", "oversized-frame"])
async def test_protocol_errors_close_4400(bad):
    h = Harness()
    task = asyncio.create_task(h.run())
    h.send(bad)
    assert await asyncio.wait_for(task, 2) == 4400


async def test_disconnect_cancels_the_reply_and_saves_the_spoken_part():
    log = []
    h = Harness(llm=llm_of("One. ", "Two."), tts=tts_of(gate_after="Two", log=log))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "Two." in log)
    h.inbox.put_nowait(None)
    assert await asyncio.wait_for(task, 2) == 1000
    assert h.store.messages[-1] == {"role": "assistant", "content": "One. …"}


# ---------------------------------------------------------------- 对抗性用例:打断的各个时间点


async def test_interrupt_during_llm_streaming_before_any_sentence_saves_no_reply():
    closed = []
    h = Harness(llm=llm_of("Hel", "lo", hang=True, closed=closed))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: len(h.of("reply_delta")) == 2)
    h.send({"type": "interrupt"})
    await h.until(lambda: "reply_done" in h.types())
    assert h.of("reply_done") == [{"type": "reply_done", "turn_id": 1, "message_id": None, "interrupted": True}]
    assert [m["role"] for m in h.store.messages] == ["user"]
    assert h.audio == [] and h.session.stats.interrupts == 1
    assert closed == [True]  # LLM 流被关闭(上游连接得以释放)
    await h.until(lambda: h.events[-1:] == [{"type": "state", "state": "listening"}])
    h.send({"type": "hangup"})
    assert await task == 1000


async def test_interrupt_during_the_first_sentence_audio_saves_no_reply():
    log = []
    h = Harness(llm=llm_of("One. ", "Two."), tts=tts_of(gate_after="One", log=log))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "One." in log)
    h.send({"type": "interrupt"})
    await h.until(lambda: "reply_done" in h.types())
    assert h.of("reply_done")[0]["message_id"] is None
    assert [m["role"] for m in h.store.messages] == ["user"]
    h.send({"type": "hangup"})
    assert await task == 1000


async def test_interrupt_between_sentences_saves_the_finished_ones():
    log = []
    h = Harness(llm=llm_of("One. ", "Two", hang=True), tts=tts_of(log=log))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: log == ["One."] and len(h.audio) == 1)
    await asyncio.sleep(0.02)  # 第一句已经播完,LLM 还卡在第二句
    h.send({"type": "interrupt"})
    await h.until(lambda: "reply_done" in h.types())
    assert h.store.messages[-1] == {"role": "assistant", "content": "One. …"}
    assert h.of("reply_done")[0]["interrupted"] is True
    h.send({"type": "hangup"})
    assert await task == 1000


async def test_interrupt_right_after_reply_done_changes_nothing():
    h = Harness()

    async def send_json(e):
        await h._json(e)
        if e["type"] == "reply_done":
            h.send({"type": "interrupt"})  # 与收尾(状态回到 listening)竞争
            await asyncio.sleep(0)

    h.session._send_json = send_json
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types() and h.events[-1:] == [{"type": "state", "state": "listening"}])
    await asyncio.sleep(0.02)
    h.send({"type": "hangup"})
    assert await task == 1000
    assert h.of("reply_done") == [{"type": "reply_done", "turn_id": 1, "message_id": "m2", "interrupted": False}]
    assert h.store.messages[-1]["content"] == "Sure. What size?"
    assert h.session.stats.interrupts == 0
    assert [e["state"] for e in h.of("state")] == ["listening", "thinking", "speaking", "listening"]


async def test_barge_in_while_replying_orders_turns_and_never_sends_stale_audio():
    log = []
    llms = iter([llm_of("One. ", "Two. ", "Three."), llm_of("Fine.")])

    def llm(messages):
        return next(llms)(messages)

    h = Harness(llm=llm, tts=tts_of(gate_after="Two", log=log),
                factory=Factory(FakeRecognizer("first"), FakeRecognizer("second")))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "Two." in log)
    await speak_once(h)  # 不先发 interrupt:音频本身就是打断
    await h.until(lambda: len(h.of("reply_done")) == 2)
    h.send({"type": "hangup"})
    assert await task == 1000
    done1 = h.log.index(("json", h.of("reply_done")[0]))
    assert h.of("reply_done")[0]["turn_id"] == 1 and h.of("reply_done")[1]["turn_id"] == 2
    assert all(entry != ("audio", 1) for entry in h.log[done1:])  # 打断之后不再有第 1 轮的音频
    assert ("audio", 2) in h.log[done1:]
    assert [m["content"] for m in h.store.messages] == ["first", "One. …", "second", "Fine."]
    finals = [e["message_id"] for e in h.of("transcript_final")]
    assert finals == ["m1", "m3"]
    assert h.session.stats.interrupts == 1 and h.session.stats.turns == 2


async def test_interrupt_then_audio_counts_one_interruption():
    gate = asyncio.Event()
    h = Harness(factory=Factory(FakeRecognizer("first", gate=gate), FakeRecognizer("second")), llm=llm_of("OK."))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: h.events[-1:] == [{"type": "state", "state": "thinking"}])
    h.send({"type": "interrupt"})  # 客户端在开口前先发 interrupt
    await speak_once(h)
    await h.until(lambda: h.factory.opened == 2)
    gate.set()
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    assert h.session.stats.interrupts == 1
    assert len(h.of("reply_done")) == 1


async def test_noise_after_a_barge_in_still_answers_the_earlier_utterance():
    gate = asyncio.Event()
    seen = []
    h = Harness(factory=Factory(FakeRecognizer("first part", gate=gate), FakeRecognizer("")), llm=llm_of("OK.", seen=seen))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: h.events[-1:] == [{"type": "state", "state": "thinking"}])
    await speak_once(h)  # 误触发:识别为空
    await h.until(lambda: h.factory.opened == 2)
    gate.set()
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    assert [m["content"] for m in h.store.messages] == ["first part", "OK."]
    assert len(seen) == 1 and seen[0][-1] == {"role": "user", "content": "first part"}


async def test_utterance_end_without_audio_and_duplicate_controls_are_ignored():
    h = Harness()
    task = asyncio.create_task(h.run())
    h.send({"type": "utterance_end"})
    h.send({"type": "interrupt"})
    await speak_once(h)
    h.send({"type": "utterance_end"})
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "interrupt"})
    h.send({"type": "utterance_end"})
    h.send({"type": "hangup"})
    assert await task == 1000
    assert h.factory.opened == 1 and h.session.stats.turns == 1 and h.session.stats.interrupts == 0
    assert len(h.of("transcript_final")) == 1


async def test_messages_after_hangup_are_ignored():
    h = Harness()
    task = asyncio.create_task(h.run())
    h.send({"type": "hangup"})
    await speak_once(h)
    h.send("not json")
    assert await task == 1000
    assert h.factory.opened == 0 and h.store.messages == []
    before = list(h.events)
    await h.session._send({"type": "state", "state": "thinking"})  # 关闭之后的发送一律丢弃
    assert h.events == before


async def test_late_assessment_after_close_is_dropped():
    gate = asyncio.Event()

    class Assessor:
        async def assess(self, message_id, pcm, text):
            await gate.wait()
            return {"status": "done", "result": {}, "assessment_id": None}

    h = Harness(assessor=Assessor())
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    gate.set()
    await h.session.drain()
    assert "assessment" not in h.types()


async def test_drain_cancels_assessments_that_overrun():
    class Assessor:
        async def assess(self, message_id, pcm, text):
            await asyncio.Event().wait()

    h = Harness(assessor=Assessor())
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    await h.session.drain(timeout=0.05)
    await asyncio.sleep(0)
    assert not h.session._assessments


# ---------------------------------------------------------------- 挂断与任务泄漏


def _others(before):
    return {t for t in asyncio.all_tasks() if t is not asyncio.current_task() and t not in before}


@pytest.mark.parametrize("stage", ["recognising", "llm", "tts"])
async def test_hangup_mid_turn_cancels_every_task(stage):
    before = set(asyncio.all_tasks())
    gate = asyncio.Event()
    closed = []
    log = []
    rec = FakeRecognizer("hi", gate=gate if stage == "recognising" else None)
    h = Harness(
        factory=Factory(rec),
        llm=llm_of("Hel", hang=True, closed=closed) if stage == "llm" else llm_of("One. ", "Two."),
        tts=tts_of(gate_after="One", log=log),
        assessor=None,
    )
    task = asyncio.create_task(h.run())
    await speak_once(h)
    if stage == "recognising":
        await h.until(lambda: h.events[-1:] == [{"type": "state", "state": "thinking"}])
    elif stage == "llm":
        await h.until(lambda: "reply_delta" in h.types())
    else:
        await h.until(lambda: "One." in log)
    if stage == "recognising":
        h.send(PCM)  # 下一句说到一半(识别器已打开)时挂断
    h.send({"type": "hangup"})
    assert await asyncio.wait_for(task, 2) == 1000
    await h.session.drain()
    assert _others(before) == set()
    if stage == "recognising":
        assert rec.aborted  # 识别中的一句被中止
        assert len(h.factory.made) == 2 and h.factory.made[-1].aborted  # 说到一半的下一句也被中止
        assert h.store.messages == []
    else:
        assert h.of("reply_done") == [{"type": "reply_done", "turn_id": 1, "message_id": None, "interrupted": True}]
        assert [m["role"] for m in h.store.messages] == ["user"]
    if stage == "llm":
        assert closed == [True]


async def test_disconnect_while_recognising_aborts_the_recognizer():
    gate = asyncio.Event()
    rec = FakeRecognizer("hi", gate=gate)
    h = Harness(factory=Factory(rec))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: h.events[-1:] == [{"type": "state", "state": "thinking"}])
    h.inbox.put_nowait(None)
    assert await asyncio.wait_for(task, 2) == 1000
    assert rec.aborted and h.store.messages == []


async def test_receive_raising_counts_as_a_disconnect():
    h = Harness()

    async def receive():
        raise RuntimeError("socket gone")

    assert await asyncio.wait_for(h.session.run(receive), 2) == 1000


# ---------------------------------------------------------------- 上游异常的映射


async def test_conversation_gone_on_user_save_closes_4004():
    h = Harness(store=FakeStore(user_error=ConversationGoneError()))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    assert await asyncio.wait_for(task, 2) == 4004


async def test_conversation_gone_on_reply_save_closes_4004():
    h = Harness(store=FakeStore(assistant_error=ConversationGoneError()))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    assert await asyncio.wait_for(task, 2) == 4004
    assert h.of("reply_done")[0]["message_id"] is None


async def test_message_limit_on_reply_save_reports_and_closes_4013():
    h = Harness(store=FakeStore(assistant_error=MessageLimitError()))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    assert await asyncio.wait_for(task, 2) == 4013
    assert {"type": "error", "code": "message_limit"} in h.events


async def test_unexpected_store_error_ends_the_turn_but_not_the_call():
    h = Harness(store=FakeStore(user_error=RuntimeError("db down")))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: [e.get("state") for e in h.of("state")][-1:] == ["listening"] and len(h.of("state")) >= 3)
    h.send({"type": "hangup"})
    assert await task == 1000
    assert "reply_delta" not in h.types()


async def test_llm_error_after_a_spoken_sentence_saves_it():
    h = Harness(llm=llm_of("One. ", "Two", error=LlmError()))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    await task
    assert {"type": "error", "code": "llm_failed"} in h.events
    assert h.store.messages[-1] == {"role": "assistant", "content": "One. …"}


async def test_unexpected_llm_and_tts_exceptions_are_mapped():
    h = Harness(llm=llm_of("Hi. ", "There.", error=ValueError("x")))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert {"type": "error", "code": "llm_failed"} in h.events

    h = Harness(tts=tts_of(error_on="Sure", error=lambda: OSError("x")))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert {"type": "error", "code": "tts_failed"} in h.events
    assert h.store.messages[-1]["content"] == "Sure. What size?"


async def test_odd_length_tts_chunk_is_a_tts_failure():
    async def odd(text):
        yield b"\x00\x00\x00"

    h = Harness(tts=odd)
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert h.of("error") == [{"type": "error", "code": "tts_failed"}]  # 只报一次
    assert h.audio == []


async def test_asr_send_failure_without_fallback_drops_the_utterance_once():
    h = Harness(factory=Factory(FakeRecognizer(send_error=AsrError("upstream")), FakeRecognizer("later")))
    task = asyncio.create_task(h.run())
    h.send(PCM)
    h.send(PCM)  # 同一句的后续音频不得开出新的识别器
    h.send({"type": "utterance_end"})
    await h.until(lambda: "error" in h.types())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert h.of("error") == [{"type": "error", "code": "asr_failed"}]
    assert h.factory.opened == 2 and h.factory.made[0].aborted
    assert h.store.messages[0]["content"] == "later"


async def test_asr_send_failure_mid_utterance_degrades_with_the_whole_utterance():
    fallback = Factory(FakeRecognizer("from fallback"), FakeRecognizer("next"))
    stream = FakeRecognizer()
    h = Harness(factory=Factory(stream), fallback=fallback)
    task = asyncio.create_task(h.run())
    h.send(PCM)
    await h.until(lambda: len(stream.audio) == len(PCM))
    stream.send_error = AsrError("upstream")
    h.send(b"\x03\x00" * 800)
    h.send({"type": "utterance_end"})
    await h.until(lambda: "reply_done" in h.types())
    await speak_once(h)  # 降级之后一直走兜底
    await h.until(lambda: len(h.of("reply_done")) == 2)
    h.send({"type": "hangup"})
    assert await task == 1000
    assert h.of("degraded") == [{"type": "degraded", "reason": "asr"}]
    assert stream.aborted
    assert bytes(fallback.made[0].audio) == PCM + b"\x03\x00" * 800
    assert [m["content"] for m in h.store.messages if m["role"] == "user"] == ["from fallback", "next"]
    assert h.factory.opened == 1 and fallback.opened == 2


async def test_asr_finish_failure_degrades_and_retries_the_utterance():
    fallback = Factory(FakeRecognizer("rescued"))
    stream = FakeRecognizer(error=AsrError("upstream"))
    h = Harness(factory=Factory(stream), fallback=fallback)
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert {"type": "degraded", "reason": "asr"} in h.events and "error" not in h.types()
    assert bytes(fallback.made[0].audio) == PCM
    assert h.store.messages[0]["content"] == "rescued"


async def test_fallback_failure_after_degrade_reports_asr_failed():
    fallback = Factory(FakeRecognizer(error=AsrError("upstream")))
    h = Harness(factory=Factory(FakeRecognizer(error=AsrError("upstream"))), fallback=fallback)
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "error" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert h.of("error") == [{"type": "error", "code": "asr_failed"}]
    assert h.store.messages == []


# ---------------------------------------------------------------- 注入时钟


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


async def test_injected_clock_drives_idle_and_max_duration():
    clock = FakeClock()
    h = Harness(clock=clock, limits=RealtimeLimits(max_seconds=100, idle_seconds=10))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "reply_done" in h.types() and h.events[-1].get("state") == "listening")
    clock.now += 9
    h.send({"type": "utterance_end"})  # 让主循环重新检查
    await asyncio.sleep(0.02)
    assert not task.done()
    clock.now += 2
    h.send({"type": "utterance_end"})
    assert await asyncio.wait_for(task, 2) == 4008


async def test_injected_clock_idle_does_not_fire_mid_turn_but_max_duration_does():
    clock = FakeClock()
    log = []
    h = Harness(clock=clock, tts=tts_of(gate_after="Sure", log=log), limits=RealtimeLimits(max_seconds=100, idle_seconds=10))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: log == ["Sure."])
    clock.now += 50
    h.send({"type": "utterance_end"})
    await asyncio.sleep(0.02)
    assert not task.done()  # 机器人正在说话:不算静音
    clock.now += 51
    h.send({"type": "utterance_end"})
    assert await asyncio.wait_for(task, 2) == 4009


async def test_injected_clock_audio_resets_idle():
    clock = FakeClock()
    h = Harness(clock=clock, factory=Factory(FakeRecognizer(gate=asyncio.Event())),
                limits=RealtimeLimits(max_seconds=100, idle_seconds=10))
    task = asyncio.create_task(h.run())
    clock.now += 8
    h.send(PCM)  # 说到一半(还没有 utterance_end)
    await h.until(lambda: h.factory.opened == 1)
    clock.now += 8
    h.send({"type": "interrupt"})
    await asyncio.sleep(0.02)
    assert not task.done()
    clock.now += 3  # 距上一帧音频 11 s:静音
    h.send({"type": "interrupt"})
    assert await asyncio.wait_for(task, 2) == 4008
    assert h.factory.made[0].aborted


# ---------------------------------------------------------------- 背压


async def test_slow_json_consumer_bounds_the_inbound_queue():
    release = asyncio.Event()
    h = Harness()

    async def slow_json(e):
        if e["type"] == "transcript_partial":
            await release.wait()
        await h._json(e)

    h.session._send_json = slow_json
    task = asyncio.create_task(h.run())
    for _ in range(300):
        h.send(PCM)
    await asyncio.sleep(0.1)
    assert h.session._queue.qsize() <= realtime_session.INBOX_MAX
    assert h.inbox.qsize() >= 300 - realtime_session.INBOX_MAX - 2  # 读取方停下来了:背压回到套接字
    release.set()
    h.send({"type": "hangup"})
    assert await asyncio.wait_for(task, 5) == 1000


async def test_slow_audio_consumer_bounds_llm_and_tts_buffering():
    release = asyncio.Event()
    produced = {"deltas": 0, "chunks": 0}

    async def llm(messages):
        for i in range(200):
            produced["deltas"] += 1
            yield f"Sentence {i}. "

    async def tts(text):
        for _ in range(100):
            produced["chunks"] += 1
            yield b"\x00\x00" * 10

    h = Harness(llm=llm, tts=tts)

    async def slow_bytes(b):
        await release.wait()
        await h._bytes(b)

    h.session._send_bytes = slow_bytes
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: produced["chunks"] >= 1)
    await asyncio.sleep(0.1)
    assert produced["chunks"] <= 2
    assert produced["deltas"] <= realtime_session.SENTENCE_QUEUE_MAX + 3
    h.send({"type": "interrupt"})
    await h.until(lambda: "reply_done" in h.types())
    assert h.of("reply_done")[0]["interrupted"] is True
    h.send({"type": "hangup"})
    assert await asyncio.wait_for(task, 2) == 1000


async def test_a_send_that_never_completes_ends_the_call(monkeypatch):
    monkeypatch.setattr(realtime_session, "SEND_TIMEOUT", 0.1)
    before = set(asyncio.all_tasks())
    h = Harness()

    async def stuck(b):
        await asyncio.Event().wait()

    h.session._send_bytes = stuck
    task = asyncio.create_task(h.run())
    await speak_once(h)
    assert await asyncio.wait_for(task, 2) == 1000
    await h.session.drain()
    assert _others(before) == set()


async def test_send_failure_ends_the_call():
    h = Harness()

    async def broken(e):
        if e["type"] == "transcript_final":
            raise RuntimeError("closed")
        await h._json(e)

    h.session._send_json = broken
    task = asyncio.create_task(h.run())
    await speak_once(h)
    assert await asyncio.wait_for(task, 2) == 1000
    assert "reply_delta" not in h.types()


@pytest.mark.parametrize("second", ["second", ""])
async def test_barge_in_while_history_loads_never_produces_two_replies(second):
    gate = asyncio.Event()
    seen = []

    class SlowHistoryStore(FakeStore):
        calls = 0

        async def history(self, limit):
            SlowHistoryStore.calls += 1
            if SlowHistoryStore.calls == 1:
                await gate.wait()  # 第一轮卡在读取历史:已过"是否回复"的检查,还没开始回复
            return await super().history(limit)

    h = Harness(store=SlowHistoryStore(), llm=llm_of("OK.", seen=seen),
                factory=Factory(FakeRecognizer("first"), FakeRecognizer(second)))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: SlowHistoryStore.calls == 1)
    await speak_once(h)
    await h.until(lambda: h.factory.opened == 2)
    gate.set()
    await h.until(lambda: "reply_done" in h.types())
    await asyncio.sleep(0.05)
    h.send({"type": "hangup"})
    assert await task == 1000
    users = ["first", "second"] if second else ["first"]  # 第二句是误触发时,仍要回复第一句
    assert len(seen) == 1 and [m["content"] for m in seen[0][1:]] == users
    assert [e["turn_id"] for e in h.of("reply_done")] == [1]
    assert [m["content"] for m in h.store.messages] == users + ["OK."]


async def test_stream_failure_after_another_path_degraded_still_retries_on_the_fallback():
    gate = asyncio.Event()
    fallback = Factory(FakeRecognizer("third"), FakeRecognizer("rescued"))  # 第二句先打开兜底,第一句的重试后打开
    first = FakeRecognizer(error=AsrError("upstream"), gate=gate)
    stream = Factory(first, open_error=None)
    h = Harness(factory=stream, fallback=fallback)
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: h.events[-1:] == [{"type": "state", "state": "thinking"}])
    stream.open_error = AsrError("upstream")  # 下一句打开流式失败 → 主循环先降级
    await speak_once(h)
    await h.until(lambda: "degraded" in h.types() and fallback.opened == 1)
    gate.set()  # 第一句的流式识别这时才失败:仍要用兜底重试,而不是报 asr_failed
    await h.until(lambda: len(h.of("transcript_final")) == 2)
    await h.until(lambda: "reply_done" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert h.of("degraded") == [{"type": "degraded", "reason": "asr"}] and "error" not in h.types()
    assert [m["content"] for m in h.store.messages] == ["rescued", "third", "Sure. What size?"]  # 按说话顺序保存


async def test_fallback_recognizer_failure_is_not_retried():
    fallback = Factory(FakeRecognizer(error=AsrError("upstream")), FakeRecognizer("never"))
    h = Harness(factory=Factory(open_error=AsrError("upstream")), fallback=fallback)
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "error" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert fallback.opened == 1 and h.of("error") == [{"type": "error", "code": "asr_failed"}]


async def test_message_limit_is_reported_once_even_with_a_queued_turn():
    gate = asyncio.Event()
    h = Harness(store=FakeStore(limit_error=True),
                factory=Factory(FakeRecognizer("one", gate=gate), FakeRecognizer("two")))
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: h.events[-1:] == [{"type": "state", "state": "thinking"}])
    await speak_once(h)
    await h.until(lambda: h.factory.opened == 2)
    gate.set()
    assert await asyncio.wait_for(task, 2) == 4013
    assert h.of("error") == [{"type": "error", "code": "message_limit"}]


# ---------------------------------------------------------------- 洪泛:识别与上游调用有界(复核 4.3-I1)


class GatedFactory(Factory):
    """每次打开都给一个卡在 finish() 的识别器(模拟很慢的上游识别)。"""

    def __init__(self, gate):
        super().__init__()
        self.gate = gate

    async def __call__(self, on_partial):
        self.opened += 1
        r = FakeRecognizer("words", gate=self.gate)
        self.made.append(r)
        return r


async def test_rate_limited_utterance_calls_no_upstream():
    h = Harness(allow=False)
    task = asyncio.create_task(h.run())
    await speak_once(h)
    await h.until(lambda: "error" in h.types())
    h.send({"type": "hangup"})
    assert await task == 1000
    assert h.factory.opened == 0  # 超限的一句不打开识别器,不调用任何上游
    assert h.of("error") == [{"type": "error", "code": "rate_limited"}]


async def test_flood_of_utterances_bounds_pending_recognitions_and_leaks_nothing():
    before = set(asyncio.all_tasks())
    gate = asyncio.Event()
    factory = GatedFactory(gate)
    h = Harness(factory=factory, limits=RealtimeLimits(max_seconds=30, idle_seconds=30))
    task = asyncio.create_task(h.run())
    for _ in range(1000):
        h.send(PCM)
        h.send({"type": "utterance_end"})
    h.send({"type": "hangup"})  # 在全部 1000 对之后处理
    assert await asyncio.wait_for(task, 10) == 1000
    await h.session.drain()
    assert factory.opened <= realtime_session.MAX_PENDING_TURNS
    assert h.session.stats.dropped_utterances == 1000 - factory.opened
    assert all(r.aborted for r in factory.made)
    assert "error" not in h.types()  # 协议没有 busy 错误码:静默丢弃
    assert _others(before) == set()


async def test_flood_never_exceeds_the_rate_limit_in_upstream_calls():
    before = set(asyncio.all_tasks())
    budget = {"left": 5}
    llm_calls = []

    def allow():
        if budget["left"] <= 0:
            return False
        budget["left"] -= 1
        return True

    h = Harness(allow=allow, llm=llm_of("OK.", seen=llm_calls), limits=RealtimeLimits(max_seconds=30, idle_seconds=30))
    task = asyncio.create_task(h.run())
    for _ in range(1000):
        h.send(PCM)
        h.send({"type": "utterance_end"})
    h.send({"type": "hangup"})
    assert await asyncio.wait_for(task, 10) == 1000  # 超限不断开
    await h.session.drain()
    assert h.factory.opened <= 5 and len(llm_calls) <= 5
    assert len(h.of("error")) >= 1000 - 5 - h.session.stats.dropped_utterances
    assert {e["code"] for e in h.of("error")} == {"rate_limited"}
    assert _others(before) == set()
