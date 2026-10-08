import asyncio
import logging

import pytest

from app.speech.realtime_asr import effective_realtime_asr
from app.realtime.realtime_tickets import RealtimeRegistry, TicketGrant, TicketStore
from tests.conftest import make_settings

ENABLED = {
    "realtime_enabled": True,
    "volcengine_tts_key": "volc-secret",
    "tts_models": "openai/tts-1,azure/speech,volcengine/seed-tts-2.0",
}


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def test_tickets_are_one_time_and_expire():
    clock = Clock()
    store = TicketStore(60, clock=clock)
    t = store.issue(7, "c1")
    assert len(t) >= 40
    assert store.redeem(t) == TicketGrant(7, "c1")
    assert store.redeem(t) is None
    t2 = store.issue(7, "c1")
    clock.now += 60.01
    assert store.redeem(t2) is None
    assert store.redeem("nope") is None


def test_ticket_is_valid_until_its_ttl_and_not_after():
    clock = Clock()
    store = TicketStore(60, clock=clock)
    t = store.issue(1, "c")
    clock.now += 59.9
    assert store.redeem(t) == TicketGrant(1, "c")
    t = store.issue(1, "c")
    clock.now += 60
    assert store.redeem(t) is None


def test_tickets_are_unique_and_carry_their_owner():
    store = TicketStore(60)
    a, b = store.issue(1, "c"), store.issue(2, "c")
    assert a != b
    assert store.redeem(b).user_id == 2 and store.redeem(a).user_id == 1


def test_ticket_store_is_bounded():
    clock = Clock()
    store = TicketStore(60, clock=clock, max_tickets=3)
    first = store.issue(1, "a")
    for i in range(3):
        store.issue(1, str(i))
    assert store.redeem(first) is None  # oldest evicted
    assert len(store) == 3


def test_expired_tickets_are_swept_before_live_ones_are_evicted():
    clock = Clock()
    store = TicketStore(60, clock=clock, max_tickets=2)
    old = store.issue(1, "old")
    clock.now += 30
    live = store.issue(1, "live")
    clock.now += 31  # old expired, live still valid
    store.issue(1, "new")
    assert store.redeem(old) is None
    assert store.redeem(live) == TicketGrant(1, "live")


def test_one_user_cannot_evict_other_users_tickets():
    # review 4.1-m3: a user holds at most `max_per_user` live tickets; their own oldest goes first
    clock = Clock()
    store = TicketStore(60, clock=clock, max_tickets=10)
    victim = store.issue(2, "v")
    mine = [store.issue(1, str(i)) for i in range(50)]
    assert store.redeem(victim) == TicketGrant(2, "v")
    assert all(store.redeem(t) is None for t in mine[:-5])
    assert [store.redeem(t) for t in mine[-5:]] == [TicketGrant(1, str(i)) for i in range(45, 50)]


def test_per_user_cap_is_configurable():
    store = TicketStore(60, max_per_user=2)
    a, b, c = store.issue(1, "a"), store.issue(1, "b"), store.issue(1, "c")
    assert store.redeem(a) is None
    assert store.redeem(b) == TicketGrant(1, "b") and store.redeem(c) == TicketGrant(1, "c")


def test_registry_one_call_per_user_and_a_global_cap():
    reg = RealtimeRegistry(max_sessions=2)
    assert reg.acquire(1) is True
    assert reg.acquire(1) is False
    assert reg.acquire(2) is True
    assert reg.acquire(3) is False
    reg.release(1)
    assert reg.acquire(3) is True and reg.active_count == 2
    reg.release(99)  # releasing an unregistered user is a no-op
    assert reg.active_count == 2


def test_registry_hold_releases_on_normal_exit():
    reg = RealtimeRegistry(1)
    with reg.hold(1) as ok:
        assert ok and reg.active_count == 1
    assert reg.active_count == 0 and reg.acquire(2)


def test_registry_hold_releases_when_the_body_raises():
    reg = RealtimeRegistry(1)
    with pytest.raises(RuntimeError):
        with reg.hold(1) as ok:
            assert ok
            raise RuntimeError("boom")
    assert reg.active_count == 0


async def test_registry_hold_releases_on_cancellation():
    reg = RealtimeRegistry(1)

    async def call():
        with reg.hold(1):
            await asyncio.sleep(10)

    task = asyncio.create_task(call())
    await asyncio.sleep(0)
    assert reg.active_count == 1
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert reg.active_count == 0


def test_registry_refused_hold_does_not_release_the_owners_slot():
    reg = RealtimeRegistry(5)
    assert reg.acquire(1)
    with reg.hold(1) as ok:
        assert ok is False
    assert reg.active_count == 1  # the first call is unaffected


# ruling R25: one helper decides the recognizer; the truth table is pinned here.
@pytest.mark.parametrize("realtime_mode", ["buffered", "stream"])
@pytest.mark.parametrize("upstream_mode", ["chat", "volc_stream"])
@pytest.mark.parametrize("fallback", [False, True])
@pytest.mark.parametrize("key", [False, True])
def test_effective_realtime_asr_truth_table(realtime_mode, upstream_mode, fallback, key):
    settings = make_settings(
        realtime_asr_mode=realtime_mode,
        upstream_asr_mode=upstream_mode,
        upstream_whisper_base_url="https://whisper.test/v1" if fallback else "",
        volcengine_asr_key="asr-key" if key else "",
        volcengine_tts_key="",
    )
    expected = "stream" if realtime_mode == "stream" and key else "buffered"
    assert effective_realtime_asr(settings) == expected


def test_asr_key_may_fall_back_to_the_tts_key():
    s = make_settings(realtime_asr_mode="stream", volcengine_asr_key="", volcengine_tts_key="tts-key")
    assert effective_realtime_asr(s) == "stream"


async def test_config_requires_login_and_reports_disabled(client, auth_headers):
    assert (await client.get("/api/realtime/config")).status_code == 401
    r = await client.get("/api/realtime/config", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == {"enabled": False, "max_minutes": 10, "idle_timeout_seconds": 60, "asr_mode": "buffered",
                        "sample_rate_in": 16000, "sample_rate_out": 24000}


@pytest.mark.parametrize("settings_overrides", [{**ENABLED, "realtime_asr_mode": "stream"}], indirect=True)
async def test_config_asr_mode_matches_the_shared_helper(client, auth_headers, app):
    body = (await client.get("/api/realtime/config", headers=auth_headers)).json()
    assert body["asr_mode"] == effective_realtime_asr(app.state.settings) == "stream"


async def test_ticket_requires_login(client):
    r = await client.post("/api/realtime/ticket", json={"conversation_id": "x"})
    assert r.status_code == 401


async def test_ticket_disabled_is_503(client, auth_headers):
    r = await client.post("/api/realtime/ticket", json={"conversation_id": "x"}, headers=auth_headers)
    assert r.status_code == 503
    assert r.json() == {"error": "Realtime is not enabled"}


@pytest.mark.parametrize("settings_overrides", [ENABLED], indirect=True)
async def test_ticket_for_own_conversation_only(client, auth_headers):
    conv = (await client.post("/api/conversations", json={"name": "c", "config": {}}, headers=auth_headers)).json()
    r = await client.post("/api/realtime/ticket", json={"conversation_id": conv["id"]}, headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"ticket", "expires_in"} and body["expires_in"] == 60
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {other.json()['access_token']}"}
    r = await client.post("/api/realtime/ticket", json={"conversation_id": conv["id"]}, headers=bob)
    assert r.status_code == 404
    missing = await client.post("/api/realtime/ticket", json={"conversation_id": "nope"}, headers=bob)
    assert missing.status_code == 404 and missing.json() == r.json()  # indistinguishable from not-found


@pytest.mark.parametrize("settings_overrides", [ENABLED], indirect=True)
async def test_issued_ticket_is_bound_to_its_user_and_single_use(client, auth_headers, app):
    conv = (await client.post("/api/conversations", json={"name": "c", "config": {}}, headers=auth_headers)).json()
    me = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    ticket = (await client.post("/api/realtime/ticket", json={"conversation_id": conv["id"]},
                                headers=auth_headers)).json()["ticket"]
    grant = app.state.realtime_tickets.redeem(ticket)
    assert grant == TicketGrant(me, conv["id"])
    assert app.state.realtime_tickets.redeem(ticket) is None


@pytest.mark.parametrize("settings_overrides", [{**ENABLED, "ai_rate_limit_per_minute": 1}], indirect=True)
async def test_ticket_issuing_consumes_the_user_rate_limit(client, auth_headers):
    conv = (await client.post("/api/conversations", json={"name": "c", "config": {}}, headers=auth_headers)).json()
    body = {"conversation_id": conv["id"]}
    assert (await client.post("/api/realtime/ticket", json=body, headers=auth_headers)).status_code == 200
    assert (await client.post("/api/realtime/ticket", json=body, headers=auth_headers)).status_code == 429


@pytest.mark.parametrize("settings_overrides", [ENABLED], indirect=True)
async def test_ticket_value_is_never_logged(client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG)
    conv = (await client.post("/api/conversations", json={"name": "c", "config": {}}, headers=auth_headers)).json()
    ticket = (await client.post("/api/realtime/ticket", json={"conversation_id": conv["id"]},
                                headers=auth_headers)).json()["ticket"]
    assert ticket not in caplog.text


@pytest.mark.parametrize("settings_overrides", [ENABLED], indirect=True)
async def test_config_enabled(client, auth_headers):
    assert (await client.get("/api/realtime/config", headers=auth_headers)).json()["enabled"] is True
