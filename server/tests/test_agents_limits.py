"""每日回合额度、按用户覆盖、工具方式回落、回合幂等账本(计划 R-C6、R-C7、R-C11、R-C13)。"""
from datetime import datetime, timezone
from types import SimpleNamespace

from app.agents import limits
from app.core.quotas import quota_cache
from app.models import User, UserQuotaOverride
from app.services import usage

NOW = datetime(2026, 10, 12, 8, 0, tzinfo=timezone.utc)


async def _user(app, uid=10000001):
    async with app.state.sessionmaker() as s:
        s.add(User(id=uid, username=f"u{uid}", password_hash="x"))
        await s.commit()


async def test_per_user_then_global_cap_and_refund(app):
    await _user(app)
    app.state.settings = app.state.settings.model_copy(update={"agents_turns_daily_per_user": 2,
                                                               "agents_turns_global_daily": 3})
    s_ = app.state.settings
    async with app.state.sessionmaker() as s:
        assert await limits.consume_turn(s, app, s_, 10000001, NOW) is None
        assert await limits.consume_turn(s, app, s_, 10000001, NOW) is None
        assert await limits.consume_turn(s, app, s_, 10000001, NOW) == "user_cap"
        await limits.refund_turn(s, 10000001, NOW)
        day = usage.utc_day(NOW)
        assert await usage.remaining(s, limits.SCOPE_TURNS_USER, "10000001", day, 2) == 1
        assert await usage.remaining(s, limits.SCOPE_TURNS_GLOBAL, "*", day, 3) == 2


async def test_global_cap_refunds_the_user_count(app):
    await _user(app)
    app.state.settings = app.state.settings.model_copy(update={"agents_turns_global_daily": 0})
    async with app.state.sessionmaker() as s:
        assert await limits.consume_turn(s, app, app.state.settings, 10000001, NOW) == "global_cap"
        assert await usage.remaining(s, limits.SCOPE_TURNS_USER, "10000001", usage.utc_day(NOW), 300) == 300


async def test_per_user_override_wins(app):
    await _user(app)
    app.state.settings = app.state.settings.model_copy(update={"agents_turns_daily_per_user": 0,
                                                               "agents_personas_max": 1})
    async with app.state.sessionmaker() as s:
        s.add(UserQuotaOverride(user_id=10000001, key="agents_turns_daily_per_user", value=1, updated_by="t"))
        s.add(UserQuotaOverride(user_id=10000001, key="agents_personas_max", value=4, updated_by="t"))
        await s.commit()
        quota_cache(app).invalidate()
        assert await limits.consume_turn(s, app, app.state.settings, 10000001, NOW) is None
        assert await limits.personas_cap(s, app, 10000001) == 4


def test_effective_tools_mode():
    s = lambda mode: SimpleNamespace(agents_tools_mode=mode)  # noqa: E731
    assert limits.effective_tools_mode(s("prefetch"), None) == "prefetch"
    assert limits.effective_tools_mode(s("off"), {"ok": True}) == "off"
    assert limits.effective_tools_mode(s("native"), None) == "prefetch"
    assert limits.effective_tools_mode(s("native"), {"ok": False}) == "prefetch"
    assert limits.effective_tools_mode(s("native"), {"ok": True}) == "native"


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def test_ledger_states_concurrency_ttl_and_size():
    clock = Clock()
    ledger = limits.TurnLedger(ttl=600, max_items=3, clock=clock)
    assert ledger.begin(1, "a")[0] == "new"
    assert ledger.begin(1, "a")[0] == "running"
    assert ledger.begin(1, "b")[0] == "new"
    assert ledger.begin(1, "c") == ("busy", None)  # two running turns already
    assert ledger.begin(2, "a")[0] == "new"  # keys are per user
    ledger.finish(1, "a", ["replay"])
    state, entry = ledger.begin(1, "a")
    assert state == "done" and entry.replay == ["replay"]
    ledger.drop(1, "b")
    assert ledger.begin(1, "b")[0] == "new"
    clock.t += 601
    assert ledger.begin(1, "a")[0] == "new"  # expired done entry
    for key in ("x", "y", "z", "w"):
        ledger.drop(1, key)
        ledger.finish(1, key, [])
    assert len(ledger) <= 3
