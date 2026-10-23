"""进程内登录失败计数(计划 S7;spec 2026-10-20-captcha-altcha R-C6、R-C8)。

假时钟:`LoginFailures(limit, window, clock=...)`,不 monkeypatch 时间。
"""
from app.core.login_failures import LoginFailures
from app.core.runtime_settings import compose


def _counter(limit=5, window=900.0, t=None):
    t = t if t is not None else [0.0]
    return LoginFailures(limit, window, clock=lambda: t[0]), t


def test_flags_after_limit_by_ip():
    counter, _ = _counter()
    for i in range(5):
        counter.record("1.1.1.1", f"name{i}")
    assert counter.flagged("1.1.1.1", "other")  # same IP, a name never seen before
    assert not counter.flagged("2.2.2.2", "brand-new")


def test_flags_after_limit_by_name():
    counter, _ = _counter()
    for i in range(5):
        counter.record(f"9.9.9.{i}", "alice@example.com")
    assert counter.flagged("9.9.9.9", "alice@example.com")
    assert not counter.flagged("9.9.9.9", "bob")


def test_unknown_names_count_like_known_ones():
    """R-C8: a name that does not exist still counts, so flagging does not reveal whether an account exists."""
    counter, _ = _counter()
    for i in range(5):
        counter.record(f"8.8.8.{i}", "nobody-here")
    assert counter.flagged("8.8.8.8", "nobody-here")


def test_window_expires():
    counter, t = _counter(window=900.0)
    for i in range(5):
        counter.record("1.1.1.1", "alice")
    assert counter.flagged("1.1.1.1", "alice")
    t[0] += 901.0
    assert not counter.flagged("1.1.1.1", "alice")


def test_name_key_is_not_plain():
    counter, _ = _counter()
    counter.record("1.1.1.1", "alice@example.com")
    assert "alice" not in repr(vars(counter))
    for limiter in (counter._ip, counter._name):
        for key in limiter._hits:
            assert "alice" not in key


def test_two_instances_use_different_keys():
    a, _ = _counter()
    b, _ = _counter()
    a.record("1.1.1.1", "alice")
    b.record("1.1.1.1", "alice")
    assert set(a._name._hits) != set(b._name._hits)


def test_reconfigure_applies_to_both_counters():
    counter, _ = _counter(limit=5)
    counter.reconfigure(limit=2, window_seconds=60.0)
    counter.record("1.1.1.1", "alice")
    assert not counter.flagged("1.1.1.1", "alice")
    counter.record("1.1.1.1", "alice")
    assert counter.flagged("1.1.1.1", "alice")
    assert counter.ip_flagged("1.1.1.1")


async def test_settings_hub_reconfigures_the_app_counter(app):
    hub = app.state.settings_hub
    hub.publish(compose(app.state.base_settings, {"captcha_login_failures": 2, "captcha_login_window_minutes": 1}))
    state = app.state.login_failures
    state.record("3.3.3.3", "carol")
    state.record("3.3.3.3", "carol")
    assert state.flagged("3.3.3.3", "carol")
    assert state._ip.window == 60.0
