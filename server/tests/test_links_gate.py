import pytest

from app.links.gate import LinkGate
from app.links.spec import LINK_KEYS, flag_of
from app.models import UserLinkPref, utcnow
from tests.links_helpers import enable_links, user_id_of


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


async def make_user(client, name="alice"):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return await user_id_of(client, h), h


async def set_pref(app, uid, key, enabled):
    async with app.state.sessionmaker() as s:
        s.add(UserLinkPref(user_id=uid, link_key=key, enabled=enabled, updated_at=utcnow()))
        await s.commit()


@pytest.mark.parametrize("master,flag,pref,expected", [
    (False, True, None, False), (True, False, None, False), (True, True, None, True),
    (True, True, True, True), (True, True, False, False), (False, False, False, False),
])
async def test_three_level_truth_table(app, client, master, flag, pref, expected):
    uid, _ = await make_user(client)
    app.state.settings = app.state.settings.model_copy(update={"links_enabled": master, flag_of("mistakes"): flag})
    if pref is not None:
        await set_pref(app, uid, "mistakes", pref)
    assert await LinkGate(app)("mistakes", uid) is expected


async def test_prefs_are_cached_for_30_seconds_and_invalidated(app, client):
    uid, _ = await make_user(client)
    enable_links(app)
    clock = Clock()
    gate = LinkGate(app, clock=clock)
    assert await gate("chat_words", uid) is True
    await set_pref(app, uid, "chat_words", False)
    assert await gate("chat_words", uid) is True  # cached
    clock.t += 31
    assert await gate("chat_words", uid) is False
    gate.invalidate(uid)
    assert (await gate.prefs(uid))["chat_words"] is False


async def test_unknown_link_is_off(app, client):
    uid, _ = await make_user(client)
    enable_links(app)
    assert await LinkGate(app)("nope", uid) is False


async def test_require_link_guards_an_endpoint(app, client):
    from fastapi import APIRouter, Depends

    from app.links.gate import require_link
    router = APIRouter()

    @router.get("/api/links/__probe")
    async def probe(user=Depends(require_link("mistakes"))):
        return {"ok": user.id}

    app.include_router(router)
    app.router.routes.insert(0, app.router.routes.pop())  # ahead of the stubs' /api/** fallback
    uid, h = await make_user(client)
    assert (await client.get("/api/links/__probe")).status_code == 401
    off = await client.get("/api/links/__probe", headers=h)
    assert (off.status_code, off.json()) == (404, {"error": "Link is off"})
    enable_links(app)
    assert (await client.get("/api/links/__probe", headers=h)).json() == {"ok": uid}


async def test_the_bus_gate_applies_the_three_levels_to_registered_links_only(app, client):
    from datetime import datetime, timezone

    from app.core.learning_events import MessageSent
    uid, _ = await make_user(client)
    bus = app.state.learning_bus
    # daily_tasks is a registered link with no event subscriber of its own, so every count below is ours alone
    assert "daily_tasks" not in bus.links()
    probe = "zz_gate_probe_not_a_link"  # unique, never a link key: only the master switch applies
    seen: list[str] = []

    def recorder(name):
        async def handler(event):
            seen.append(name)
        return handler
    bus.subscribe(MessageSent, "daily_tasks", recorder("daily_tasks"))
    bus.subscribe(MessageSent, probe, recorder(probe))

    async def send():
        seen.clear()
        bus.publish(MessageSent(user_id=uid, conversation_id="c", message_id="m", text="hi",
                                at=datetime.now(timezone.utc)))
        await bus.drain()
        return sorted(seen)

    enable_links(app, link_daily_tasks_enabled=False)  # registered link, globally off
    assert await send() == [probe]
    assert (bus.stats()["daily_tasks"]["handled"], bus.stats()["daily_tasks"]["skipped"]) == (0, 1)
    assert (bus.stats()[probe]["handled"], bus.stats()[probe]["skipped"]) == (1, 0)
    enable_links(app, link_daily_tasks_enabled=True)
    await set_pref(app, uid, "daily_tasks", False)  # globally on, this user off
    app.state.link_gate.invalidate(uid)
    assert await send() == [probe]
    assert (bus.stats()["daily_tasks"]["handled"], bus.stats()["daily_tasks"]["skipped"]) == (0, 2)
    async with app.state.sessionmaker() as s:
        row = await s.get(UserLinkPref, (uid, "daily_tasks"))
        row.enabled = True
        await s.commit()
    app.state.link_gate.invalidate(uid)
    assert await send() == ["daily_tasks", probe]  # every level on: the link handler runs
    assert (bus.stats()["daily_tasks"]["handled"], bus.stats()["daily_tasks"]["skipped"]) == (1, 2)
    enable_links(app, links_enabled=False)  # master off: nothing is even queued, for links and non-links alike
    assert await send() == [] and bus.queue()["size"] == 0


def test_every_link_key_has_a_settings_flag():
    from app.core.config import Settings
    assert all(flag_of(k) in Settings.model_fields for k in LINK_KEYS)


def test_every_installed_subscription_uses_its_registered_link_key(app):
    """Review Z2: the bus gate applies the three switches only to registered keys; a handler subscribed under
    any other name would ignore the global and per-user switches."""
    from app.links.registry import keys
    # lane L4: the `activation.*` subscriptions carry their own master switch (ACTIVATION_ENABLED, plan R3/R4), not a link key
    subscribed = {k for k in app.state.learning_bus.links() if not k.startswith("activation.")}
    assert subscribed <= set(keys())
    assert subscribed == {"mistakes", "pron_shadow", "chat_words"}
