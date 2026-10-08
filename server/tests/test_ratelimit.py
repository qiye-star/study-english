from app.core.ratelimit import RateLimiter


def test_allows_up_to_limit_then_blocks():
    now = [0.0]
    rl = RateLimiter(limit=2, window=60.0, clock=lambda: now[0])
    assert rl.allow("ip") and rl.allow("ip")
    assert rl.allow("ip") is False


def test_window_slides():
    now = [0.0]
    rl = RateLimiter(limit=1, window=60.0, clock=lambda: now[0])
    assert rl.allow("ip")
    assert rl.allow("ip") is False
    now[0] = 60.0
    assert rl.allow("ip") is True


def test_keys_are_independent():
    rl = RateLimiter(limit=1)
    assert rl.allow("a") and rl.allow("b")
    assert rl.allow("a") is False


def test_empty_keys_are_dropped_after_window():
    now = [0.0]
    rl = RateLimiter(limit=1, window=60.0, clock=lambda: now[0])
    rl.allow("gone")
    now[0] = 120.0
    rl.allow("other")
    rl.allow("gone")
    assert "gone" in rl._hits and len(rl._hits) == 2
    now[0] = 300.0
    rl.allow("x")
    assert set(rl._hits) == {"x"}
