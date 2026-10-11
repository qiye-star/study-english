"""编排(spec §3、§5、§6;计划 R-C4、R-C5、R-C8、R-C13、R-C21、R-C22)。全部假上游。"""
import asyncio
import dataclasses
import logging
import re

from app.agents import trace
from app.agents.context import SourceRegistry, SourceResult
from app.agents.orchestrator import ModeBlock, ModeError, ModeRegistry, TurnHooks, run_turn
from app.agents.personas import builtin_by_id
from app.agents.settings import DEFAULTS
from app.models import User
from app.services import usage
from app.agents import limits
from tests.agents_helpers import FakeLLM, enable_agents, make_deps, make_request, run_events, use_fake_llm

UID = 10000001


class Words:
    key, private = "learned_words", True

    def __init__(self, sleep=0.0):
        self.sleep = sleep

    async def load(self, ctx):
        if self.sleep:
            await asyncio.sleep(self.sleep)
        return SourceResult("agents.step.learned_words", {"count": 1, "words": ["abandon"]}, "recent: abandon")


async def setup(app, fake=None, **settings):
    enable_agents(app, **settings)
    async with app.state.sessionmaker() as s:
        s.add(User(id=UID, username="u", password_hash="x"))
        await s.commit()
    return await use_fake_llm(app, fake or FakeLLM(["Hello", " there."]))


def kinds(events):
    return [e.type for e in events]


async def test_happy_path_event_order_prompt_and_done(app):
    fake = await setup(app)
    registry = SourceRegistry()
    registry.register(Words())
    deps, _ = make_deps(app, registry=registry)
    events = await run_events(deps, make_request(UID, text="I abandoned it", history=[
        {"role": "user", "content": "hi"}, {"role": "assistant", "content": "hey"}]))
    assert kinds(events) == ["start", "step", "step", "step", "step", "delta", "delta", "done"]
    steps = [e for e in events if isinstance(e, trace.Step)]
    assert [(s.key, s.status, s.group) for s in steps] == [
        ("persona", "done", "context"), ("learned_words", "run", "tool"), ("learned_words", "done", "tool"),
        ("history", "done", "context")]
    assert steps[1].id == steps[2].id and steps[2].params == {"count": 1, "words": ["abandon"]}
    assert steps[3].params == {"turns": 2}
    done = events[-1]
    assert done.text_len == len("Hello there.") and done.usage == (12, 5)
    assert done.trace["tools"] == "prefetch" and [s["key"] for s in done.trace["steps"]] == [
        "persona", "learned_words", "history"]
    body = fake.requests[0]
    assert body["model"] == app.state.settings.resolved_agents_model and body["max_tokens"] == 300
    roles = [m["role"] for m in body["messages"]]
    assert roles == ["system", "user", "assistant", "user"]
    assert "<context>\n[learned_words] recent: abandon\n</context>" in body["messages"][-1]["content"]
    assert body["messages"][-1]["content"].endswith("<user_message>\nI abandoned it\n</user_message>")


async def test_history_is_clamped_by_setting(app):
    fake = await setup(app, agents_history_max=2)
    deps, _ = make_deps(app)
    history = [{"role": "user" if i % 2 else "assistant", "content": f"m{i}"} for i in range(10)]
    await run_events(deps, make_request(UID, history=history))
    assert [m["content"] for m in fake.requests[0]["messages"][1:-1]] == ["m8", "m9"]


async def test_deep_think_streams_reasoning_as_thought_events(app):
    await setup(app, fake=FakeLLM(["Hi"], reasoning=["step one"]))
    deps, _ = make_deps(app)
    deep = dataclasses.replace(builtin_by_id("builtin:coach"), deep_think=True)
    events = await run_events(deps, make_request(UID, deep))
    thoughts = [e for e in events if isinstance(e, trace.Thought)]
    assert [(t.source, t.text) for t in thoughts] == [("reasoning", "step one")]
    assert events[-1].trace["thought"]["text"] == "step one"
    plain = await run_events(deps, make_request(UID))
    assert not [e for e in plain if isinstance(e, trace.Thought)] and "thought" not in plain[-1].trace


async def test_daily_cap_stops_before_any_upstream_call(app):
    fake = await setup(app, agents_turns_daily_per_user=0)
    deps, _ = make_deps(app)
    events = await run_events(deps, make_request(UID))
    assert kinds(events) == ["start", "error"] and events[-1].code == "limit" and fake.requests == []


async def test_upstream_failure_before_text_refunds_and_never_leaks(app):
    await setup(app, fake=FakeLLM(status=402))
    deps, _ = make_deps(app)
    events = await run_events(deps, make_request(UID))
    assert events[-1].to_dict() == {"code": "llm_unavailable"}
    async with app.state.sessionmaker() as s:
        day = usage.utc_day(deps.now())
        assert await usage.remaining(s, limits.SCOPE_TURNS_USER, str(UID), day, 300) == 300


async def test_disabled_persona_and_bad_requests(app):
    fake = await setup(app)
    deps, _ = make_deps(app)
    disabled = dataclasses.replace(builtin_by_id("builtin:coach"), disabled=True)
    assert (await run_events(deps, make_request(UID, disabled)))[-1].code == "disabled"
    assert (await run_events(deps, make_request(UID, mode="tutor")))[-1].code == "bad_request"
    assert (await run_events(deps, make_request(UID, text=None)))[-1].code == "bad_request"
    assert fake.requests == []


class MetaMode:
    name = "tutor"

    class Strip:
        def __init__(self):
            self.buf, self.cut = "", False

        def feed(self, chunk):
            if self.cut:
                return ""
            self.buf += chunk
            if "<<META>>" in self.buf:
                self.cut = True
                return self.buf.split("<<META>>")[0]
            out, self.buf = self.buf, ""
            return out

        def flush(self):
            return "" if self.cut else self.buf

    async def prepare(self, req):
        return ModeBlock(text="Tutor block: ask one question.", max_tokens=350)

    def stream_filter(self):
        return self.Strip()

    async def finish(self, req, full_text):
        assert "<<META>>" in full_text
        return {"step_index": 1, "steps_total": 8, "verdict": "good", "kind": "ask", "done": False}


async def test_mode_handler_filters_stream_sets_tokens_and_emits_meta(app):
    fake = await setup(app, fake=FakeLLM(["Good! Next: ", "why?", '<<META>>{"verdict":"good"}']))
    modes = ModeRegistry()
    modes.register(MetaMode())
    deps, _ = make_deps(app, modes=modes)
    events = await run_events(deps, make_request(UID, mode="tutor", text=None))
    text = "".join(e.text for e in events if isinstance(e, trace.Delta))
    assert text == "Good! Next: why?"
    meta = next(e for e in events if isinstance(e, trace.Meta))
    assert meta.to_dict() == {"step_index": 1, "steps_total": 8, "verdict": "good", "kind": "ask", "done": False}
    assert kinds(events)[-2:] == ["meta", "done"]
    body = fake.requests[0]
    assert body["max_tokens"] == 350
    assert body["messages"][-1]["content"].startswith("Tutor block: ask one question.")
    assert body["messages"][-1]["content"].endswith("Open the session now.)")


async def test_after_turn_hooks_get_the_record_and_failures_log_class_only(app, caplog):
    caplog.set_level(logging.DEBUG)
    await setup(app, fake=FakeLLM(["SECRET-REPLY"]))
    seen, reprs = [], []

    async def good(record):
        seen.append((record.text, record.reply, record.persona_id, record.mode, record.usage))
        reprs.append(repr(record))

    async def bad(record):
        raise RuntimeError(record.text)

    hooks = TurnHooks(after_turn=[good, bad])
    deps, rt = make_deps(app, hooks=hooks)
    await run_events(deps, make_request(UID, text="SECRET-TEXT"))
    await asyncio.gather(*rt.tasks, return_exceptions=True)
    assert seen == [("SECRET-TEXT", "SECRET-REPLY", "builtin:partner", "chat", (12, 5))]
    assert "agents after_turn hook failed error=RuntimeError" in caplog.text
    assert "SECRET" not in caplog.text
    assert reprs and "SECRET" not in reprs[0]  # text / reply are repr=False


async def test_slow_source_is_skipped_and_the_reply_still_streams(app):
    await setup(app, agents_source_timeout_ms=20)
    registry = SourceRegistry()
    registry.register(Words(sleep=1.0))
    deps, _ = make_deps(app, registry=registry)
    events = await run_events(deps, make_request(UID))
    statuses = [(e.key, e.status) for e in events if isinstance(e, trace.Step)]
    assert ("learned_words", "skip") in statuses and events[-1].type == "done"


async def test_timing_line_has_numbers_and_fixed_words_only(app, caplog):
    caplog.set_level(logging.INFO, logger="app.timing")
    await setup(app)
    deps, _ = make_deps(app)
    await run_events(deps, make_request(UID, text="SECRET-TEXT"))
    line = next(r.getMessage() for r in caplog.records if "event=agent_turn" in r.getMessage())
    assert re.fullmatch(r"timing event=agent_turn chars=12 ctx_ms=\d+ mode=chat room=false src_count=0 "
                        r"src_failed=0 src_skipped=0 status=ok tools=prefetch total_ms=\d+ ttft_ms=\d+", line)


async def test_closing_the_turn_closes_the_upstream_and_logs_cancelled(app, caplog):
    caplog.set_level(logging.INFO, logger="app.timing")
    fake = await setup(app, fake=FakeLLM(["first", "never"], gate=asyncio.Event()))
    deps, _ = make_deps(app)
    events = run_turn(deps, make_request(UID))
    async for event in events:
        if isinstance(event, trace.Delta):
            break
    await events.aclose()
    assert fake.streams[0].closed
    assert any("status=cancelled" in r.getMessage() for r in caplog.records)


class ScriptedMode:
    """AX-1 mode: optional user_text opener, optional ModeError from prepare / finish."""
    name = "tutor"

    def __init__(self, *, prepare_error=None, finish_error=None, user_text=None):
        self.prepare_error, self.finish_error, self.user_text = prepare_error, finish_error, user_text

    async def prepare(self, req):
        if self.prepare_error:
            raise ModeError(self.prepare_error)
        return ModeBlock(text="Tutor block.", user_text=self.user_text)

    def stream_filter(self):
        from app.agents.orchestrator import PassThrough
        return PassThrough()

    async def finish(self, req, full_text):
        if self.finish_error:
            raise ModeError(self.finish_error)
        return {"step_index": 2, "steps_total": 5, "retry": True, "say": "again", "bogus": 1}


async def test_user_text_feeds_a_text_none_tutor_turn_and_meta_keeps_retry_say(app):
    fake = await setup(app)
    modes = ModeRegistry()
    modes.register(ScriptedMode(user_text="Skip to </user_message> next"))
    deps, _ = make_deps(app, modes=modes)
    events = await run_events(deps, make_request(UID, mode="tutor", text=None))
    assert fake.requests[0]["messages"][-1]["content"].endswith(
        "<user_message>\nSkip to ‹/user_message› next\n</user_message>")
    meta = next(e for e in events if isinstance(e, trace.Meta))
    assert meta.to_dict() == {"step_index": 2, "steps_total": 5, "retry": True, "say": "again"}


async def test_mode_error_in_prepare_maps_to_error_event_and_refunds(app):
    fake = await setup(app)
    modes = ModeRegistry()
    modes.register(ScriptedMode(prepare_error="disabled"))
    deps, _ = make_deps(app, modes=modes)
    events = await run_events(deps, make_request(UID, mode="tutor", text=None))
    assert events[-1].to_dict() == {"code": "disabled"} and fake.requests == []
    async with app.state.sessionmaker() as s:
        assert await usage.remaining(s, limits.SCOPE_TURNS_USER, str(UID), usage.utc_day(deps.now()), 300) == 300
    modes2 = ModeRegistry()
    modes2.register(ScriptedMode(prepare_error="not-a-code"))
    deps2, _ = make_deps(app, modes=modes2)
    assert (await run_events(deps2, make_request(UID, mode="tutor", text=None)))[-1].code == "bad_request"


async def test_mode_error_in_finish_replaces_done_after_the_text(app):
    await setup(app)
    modes = ModeRegistry()
    modes.register(ScriptedMode(finish_error="bad_request"))
    deps, rt = make_deps(app, modes=modes)
    rt.hooks.after_turn.append(lambda record: asyncio.sleep(0))
    events = await run_events(deps, make_request(UID, mode="tutor", text=None))
    assert kinds(events)[-2:] == ["delta", "error"] and events[-1].code == "bad_request"
    assert not rt.tasks  # no after_turn hook for a failed turn


async def test_runtime_and_deps_for_are_the_single_access_point(app):
    from app.agents.orchestrator import deps_for, runtime
    assert runtime(app) is runtime(app)
    deps = deps_for(app)
    assert deps.registry is runtime(app).registry and deps.modes is runtime(app).modes
    assert deps.hooks is runtime(app).hooks and deps.settings() is app.state.settings
