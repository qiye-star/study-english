"""管理端「学习联动」(learning links spec §9;计划 LA-1)。"""
from dataclasses import replace

import pytest
from sqlalchemy import select

from app.core import rank_sources
from app.core.learning_events import WordAnswered
from app.models import AdminAudit, UserLinkPref, utcnow
from tests.admin_helpers import ADMIN_ENABLED, assert_no_secrets, login_as
from tests.links_helpers import enable_links

# 与 chat_words 联动(L5)登记的来源逐字段相同,合并后重复登记是幂等的
SOURCE = rank_sources.RankSource("word_in_chat", 1, "对话用到新词", "New word used in chat")


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "links_enabled": True, "links_breaker_failures": 1}


@pytest.fixture
def word_in_chat():
    saved = rank_sources.registered()
    rank_sources.clear_for_tests()
    rank_sources.register(SOURCE)
    yield
    rank_sources.clear_for_tests()
    for s in saved:
        rank_sources.register(s)


def _event(user_id: int, word: str = "secretword") -> WordAnswered:
    return WordAnswered(user_id=user_id, book_id="junior", word=word, kind="review", qtype="meaning",
                        outcome="wrong", credit=0, at=utcnow())


def _keys(value) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in _keys(v)}
    if isinstance(value, list):
        return {k for v in value for k in _keys(v)}
    return set()


async def test_view_shows_counters_sources_and_errors_without_pii(app, client, word_in_chat):
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    uid = int((await client.get("/api/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})).json()["id"])
    async with app.state.sessionmaker() as s:
        s.add(UserLinkPref(user_id=uid, link_key="mistakes", enabled=False, updated_at=utcnow()))
        await s.commit()
    bus = app.state.learning_bus

    async def boom(e):
        raise RuntimeError("talk")
    bus.subscribe(WordAnswered, "pron_shadow", boom)
    bus.publish(_event(uid + 1))
    await bus.drain()
    await login_as(app, client, "viewer")
    body = (await client.get("/api/admin/links")).json()
    assert body["enabled"] is True and body["process_local"] is True
    assert body["queue"] == {"size": 0, "max": 1000, "dropped": 0}
    by_key = {l["key"]: l for l in body["links"]}
    assert list(by_key) == ["word_actions", "daily_tasks", "mistakes", "pron_shadow", "chat_words", "rank_sources"]
    assert by_key["mistakes"]["users_off"] == 1 and by_key["pron_shadow"]["users_off"] == 0
    assert by_key["pron_shadow"]["breaker"] == "open" and by_key["pron_shadow"]["open_seconds"] > 0
    assert by_key["pron_shadow"]["stats"]["failed"] == 1 and by_key["pron_shadow"]["stats"]["published"] == 1
    assert by_key["word_actions"]["breaker"] == "closed" and by_key["word_actions"]["stats"]["handled"] == 0
    assert by_key["pron_shadow"]["subscribed"] is True and by_key["word_actions"]["subscribed"] is False
    assert by_key["mistakes"]["global"] is True and by_key["mistakes"]["effective"] is True
    assert by_key["mistakes"]["label_zh"] and by_key["mistakes"]["label_en"]
    assert body["errors"][0] == {**body["errors"][0], "link": "pron_shadow", "event": "WordAnswered", "error": "RuntimeError"}
    assert set(body["errors"][0]) == {"at", "link", "event", "error"}
    assert body["rank_sources"] == [{"kind": "word_in_chat", "default_points": 1, "points": 1,
                                     "label_zh": "对话用到新词", "label_en": "New word used in chat"}]
    text = str(body)
    assert "secretword" not in text and "talk" not in text and "alice" not in text
    # Ruling: 用户 id 是小整数,「str(uid) not in text」会撞上计数;改为断言没有任何用户相关的键
    assert not _keys(body) & {"user", "user_id", "users", "username", "word", "text"}
    assert_no_secrets(body, app.state.settings)


async def test_view_reflects_global_and_master_switches(app, client):
    enable_links(app, link_mistakes_enabled=False)
    await login_as(app, client, "viewer")
    body = (await client.get("/api/admin/links")).json()
    mistakes = next(l for l in body["links"] if l["key"] == "mistakes")
    assert mistakes["global"] is False and mistakes["effective"] is False
    enable_links(app, links_enabled=False, link_mistakes_enabled=True)
    body = (await client.get("/api/admin/links")).json()
    assert body["enabled"] is False
    assert all(l["effective"] is False for l in body["links"]) and all(l["global"] for l in body["links"])
    assert body["errors"] == [] and all(l["breaker"] == "closed" for l in body["links"])


async def test_view_needs_an_admin_session(app, client):
    assert (await client.get("/api/admin/links")).status_code == 401


async def test_reset_breaker_needs_operator_and_is_audited(app, client):
    async def boom(e):
        raise RuntimeError()
    bus = app.state.learning_bus
    bus.subscribe(WordAnswered, "pron_shadow", boom)
    bus.publish(_event(1))
    await bus.drain()
    assert bus.stats()["pron_shadow"]["breaker"] == "open"
    viewer = await login_as(app, client, "viewer")
    assert (await client.post("/api/admin/links/pron_shadow/reset-breaker", headers=viewer)).status_code == 403
    op = await login_as(app, client, "operator")
    assert (await client.post("/api/admin/links/pron_shadow/reset-breaker")).status_code == 403  # CSRF
    r = await client.post("/api/admin/links/pron_shadow/reset-breaker", headers=op)
    assert r.status_code == 200 and r.json() == {"key": "pron_shadow", "state": "closed"}
    assert bus.stats()["pron_shadow"]["breaker"] == "closed"
    missing = await client.post("/api/admin/links/nope/reset-breaker", headers=op)
    assert missing.status_code == 404 and missing.json() == {"error": "Unknown link"}
    async with app.state.sessionmaker() as s:
        audit = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "links.breaker.reset"))).one()
    assert audit.target_type == "link" and audit.target_id == "pron_shadow" and audit.summary == "pron_shadow"


async def test_reset_breaker_of_a_link_without_subscribers_still_answers_closed(app, client):
    # daily_tasks 只有接口没有订阅:通道里没有它的统计,复位照样成功(幂等),并且留审计
    op = await login_as(app, client, "operator")
    r = await client.post("/api/admin/links/daily_tasks/reset-breaker", headers=op)
    assert r.json() == {"key": "daily_tasks", "state": "closed"}
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(AdminAudit.target_id).where(AdminAudit.action == "links.breaker.reset"))).all() \
            == ["daily_tasks"]


async def test_doctor_flags_open_breakers(app, client):
    from app.admin import doctor

    async def boom(e):
        raise ValueError()
    app.state.learning_bus.subscribe(WordAnswered, "mistakes", boom)
    app.state.learning_bus.publish(WordAnswered(user_id=1, book_id="b", word="w", kind="review", qtype=None,
                                                outcome="wrong", credit=0, at=utcnow()))
    await app.state.learning_bus.drain()
    async with app.state.sessionmaker() as s:
        facts = await doctor.gather_facts(s, app)
    assert facts.links_breakers_open == 1 and facts.links_dropped == 0
    found = {f.code: f for f in doctor.diagnose(app.state.settings, facts)}
    assert found["links_breaker_open"].level == "warn" and found["links_breaker_open"].keys == ("links_enabled",)
    assert "1 个联动熔断中" in found["links_breaker_open"].message_zh
    assert "links_dropping" not in found


async def test_doctor_flags_dropped_events(app, client):
    from app.admin import doctor

    async def noop(e):
        return None
    enable_links(app, links_queue_max=1)  # model_copy 不校验下限,方便造出丢弃
    app.state.learning_bus.subscribe(WordAnswered, "mistakes", noop)
    assert app.state.learning_bus.publish(_event(1)) is True
    assert app.state.learning_bus.publish(_event(1)) is False
    async with app.state.sessionmaker() as s:
        facts = await doctor.gather_facts(s, app)
    await app.state.learning_bus.drain()
    assert facts.links_dropped == 1 and facts.links_breakers_open == 0
    found = {f.code: f for f in doctor.diagnose(app.state.settings, facts)}
    assert found["links_dropping"].level == "warn" and "LINKS_QUEUE_MAX" in found["links_dropping"].message_zh
    assert {"links_breaker_open", "links_dropping"} <= set(doctor.CODES)


def test_doctor_is_quiet_without_learning_link_trouble():
    from app.admin import doctor
    from tests.test_admin_doctor import OK
    from tests.conftest import make_settings
    assert OK.links_breakers_open == 0 and OK.links_dropped == 0
    quiet = {f.code for f in doctor.diagnose(make_settings(links_enabled=True), OK)}
    assert not quiet & {"links_breaker_open", "links_dropping"}
    loud = {f.code for f in doctor.diagnose(make_settings(), replace(OK, links_breakers_open=2, links_dropped=3))}
    assert {"links_breaker_open", "links_dropping"} <= loud


async def test_doctor_without_a_bus_reports_nothing(app, client):
    from app.admin import doctor
    bus = app.state.learning_bus
    del app.state.learning_bus
    try:
        async with app.state.sessionmaker() as s:
            facts = await doctor.gather_facts(s, app)
    finally:
        app.state.learning_bus = bus
    assert facts.links_breakers_open == 0 and facts.links_dropped == 0
