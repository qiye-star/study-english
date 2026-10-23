"""L5 S7:`/api/dubbing` 的配置与角色接口(plan L5 R6–R8、R4、R7 的接口形状)。"""
import pytest

from app.library import roles_ai
from app.providers import llm
from tests.dubbing_helpers import LLM_BASE, five_lines, make_item, make_user, user_id_of, dubbing_settings
from tests.library_helpers import enable


@pytest.fixture
def settings_overrides(request, tmp_path):
    return dubbing_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)  # the library needs ffmpeg on PATH; tests pretend it is there


def fake_llm(monkeypatch, reply: str | None = None, exc: Exception | None = None) -> list:
    calls: list = []

    async def complete(http, settings, messages, **kwargs):
        calls.append(messages)
        if exc is not None:
            raise exc
        return reply

    monkeypatch.setattr(roles_ai.llm, "complete", complete)
    return calls


async def test_config_reports_the_switches_and_the_placeholder_limits(app, client, auth_headers):
    body = (await client.get("/api/dubbing/config", headers=auth_headers)).json()
    assert body["enabled"] is True and body["suggest"] is False  # no LLM configured in tests
    assert body["limits"] == {"max_lines": 12, "max_ms": 90000, "window_before_ms": 300, "window_after_ms": 600,
                              "sync_tolerance_ms": 400, "weights": {"pronunciation": 60, "fluency": 20, "sync": 20},
                              "max_roles": 6}


@pytest.mark.parametrize("settings_overrides", [{"library_ai_enabled": True, "upstream_llm_base_url": LLM_BASE}],
                         indirect=True)
async def test_config_offers_suggestions_only_with_the_library_ai_switch(client, auth_headers):
    assert (await client.get("/api/dubbing/config", headers=auth_headers)).json()["suggest"] is True


@pytest.mark.parametrize("settings_overrides", [{"dubbing_enabled": False}], indirect=True)
async def test_switch_off_is_404_for_everything_but_it_needs_a_login_first(app, client, auth_headers):
    item = await make_item(app, await user_id_of(app), five_lines())
    assert (await client.get("/api/dubbing/config", headers=auth_headers)).json()["enabled"] is False
    assert (await client.get(f"/api/dubbing/items/{item}/roles", headers=auth_headers)).status_code == 404
    r = await client.get(f"/api/dubbing/items/{item}/roles", headers=auth_headers)
    assert r.json() == {"error": "Dubbing is disabled"}
    assert (await client.get(f"/api/dubbing/items/{item}/roles")).status_code == 401
    assert (await client.get("/api/dubbing/config")).status_code == 401


async def test_roles_read_and_update_round_trip(app, client, auth_headers):
    item = await make_item(app, await user_id_of(app), five_lines())
    got = (await client.get(f"/api/dubbing/items/{item}/roles", headers=auth_headers)).json()
    assert got["names"] == [] and got["editable"] is True and got["locked"] is None
    assert [s["speaker"] for s in got["speakers"]] == [None] * 5
    r = await client.put(f"/api/dubbing/items/{item}/roles", headers=auth_headers,
                         json={"names": {"A": "Ann"}, "speakers": [{"idx": 0, "speaker": "A"}]})
    assert r.status_code == 200, r.text
    assert r.json()["names"] == [{"key": "A", "name": "Ann"}] and r.json()["speakers"][0]["speaker"] == "A"
    again = (await client.get(f"/api/dubbing/items/{item}/roles", headers=auth_headers)).json()
    assert again["speakers"][0]["speaker"] == "A"


async def test_invalid_roles_and_copies_are_refused(app, client, auth_headers):
    uid = await user_id_of(app)
    item = await make_item(app, uid, five_lines())
    r = await client.put(f"/api/dubbing/items/{item}/roles", headers=auth_headers, json={"names": {"G": "x"}})
    assert r.status_code == 400 and r.json() == {"error": "Invalid roles"}
    copy = await make_item(app, uid, five_lines(), catalog_id="11111111-2222-4333-8444-555555555555")
    got = (await client.get(f"/api/dubbing/items/{copy}/roles", headers=auth_headers)).json()
    assert got["editable"] is False and got["locked"] == "catalog"
    r = await client.put(f"/api/dubbing/items/{copy}/roles", headers=auth_headers, json={"names": {"A": "Ann"}})
    assert r.status_code == 409 and r.json() == {"error": "Roles are set by the editors"}


@pytest.mark.parametrize("settings_overrides", [{"library_ai_enabled": True, "upstream_llm_base_url": LLM_BASE}],
                         indirect=True)
async def test_a_copy_cannot_get_suggestions_either(app, client, auth_headers, monkeypatch):
    copy = await make_item(app, await user_id_of(app), five_lines(), catalog_id="11111111-2222-4333-8444-555555555555")
    calls = fake_llm(monkeypatch, "1. A")
    r = await client.post(f"/api/dubbing/items/{copy}/roles/suggest", headers=auth_headers,
                          json={"seg_from": 0, "seg_to": 1})
    assert r.status_code == 409 and r.json() == {"error": "Roles are set by the editors"}
    assert calls == []


async def test_other_users_and_unready_items_are_not_visible_or_editable(app, client, auth_headers):
    bob = await make_user(app, 2222222, "bob")
    theirs = await make_item(app, bob, five_lines())
    assert (await client.get(f"/api/dubbing/items/{theirs}/roles", headers=auth_headers)).status_code == 404
    processing = await make_item(app, await user_id_of(app), five_lines(), status="processing")
    r = await client.get(f"/api/dubbing/items/{processing}/roles", headers=auth_headers)
    assert r.status_code == 409 and r.json() == {"error": "Item is not ready"}


@pytest.mark.parametrize("settings_overrides", [{"library_ai_enabled": False}], indirect=True)
async def test_suggest_is_404_without_the_library_ai_switch(app, client, auth_headers):
    item = await make_item(app, await user_id_of(app), five_lines())
    r = await client.post(f"/api/dubbing/items/{item}/roles/suggest", headers=auth_headers,
                          json={"seg_from": 0, "seg_to": 1})
    assert r.status_code == 404 and r.json() == {"error": "Not Found"}


@pytest.mark.parametrize("settings_overrides", [{"library_ai_enabled": True, "upstream_llm_base_url": LLM_BASE}],
                         indirect=True)
async def test_suggest_returns_letters_and_writes_nothing(app, client, auth_headers, monkeypatch):
    item = await make_item(app, await user_id_of(app), five_lines())
    fake_llm(monkeypatch, "1. A\n2. B\n3. A")
    r = await client.post(f"/api/dubbing/items/{item}/roles/suggest", headers=auth_headers,
                          json={"seg_from": 0, "seg_to": 2})
    assert r.status_code == 200, r.text
    assert r.json() == {"speakers": [{"idx": 0, "speaker": "A"}, {"idx": 1, "speaker": "B"}, {"idx": 2, "speaker": "A"}]}
    got = (await client.get(f"/api/dubbing/items/{item}/roles", headers=auth_headers)).json()
    assert [s["speaker"] for s in got["speakers"]] == [None] * 5  # a suggestion only: nothing was saved


@pytest.mark.parametrize("settings_overrides", [{"library_ai_enabled": True, "upstream_llm_base_url": LLM_BASE}],
                         indirect=True)
async def test_suggest_clip_rules_are_enforced_by_the_server(app, client, auth_headers, monkeypatch):
    item = await make_item(app, await user_id_of(app), five_lines())
    fake_llm(monkeypatch, "1. A")
    r = await client.post(f"/api/dubbing/items/{item}/roles/suggest", headers=auth_headers,
                          json={"seg_from": 2, "seg_to": 1})
    assert r.status_code == 400 and r.json() == {"error": "Invalid clip"}
    many = await make_item(app, await user_id_of(app), [(i * 1000, i * 1000 + 900, f"Line {i}.") for i in range(13)])
    r = await client.post(f"/api/dubbing/items/{many}/roles/suggest", headers=auth_headers,
                          json={"seg_from": 0, "seg_to": 12})
    assert r.status_code == 400 and r.json() == {"error": "Clip is too long"}


@pytest.mark.parametrize("settings_overrides", [{"library_ai_enabled": True, "upstream_llm_base_url": LLM_BASE,
                                                 "dubbing_suggest_daily_per_user": 0}], indirect=True)
async def test_suggest_over_the_daily_allowance_is_429(app, client, auth_headers, monkeypatch):
    item = await make_item(app, await user_id_of(app), five_lines())
    calls = fake_llm(monkeypatch, "1. A")
    r = await client.post(f"/api/dubbing/items/{item}/roles/suggest", headers=auth_headers,
                          json={"seg_from": 0, "seg_to": 0})
    assert r.status_code == 429 and r.json() == {"error": "Daily AI limit reached"}
    assert calls == []


@pytest.mark.parametrize("settings_overrides", [{"library_ai_enabled": True, "upstream_llm_base_url": LLM_BASE,
                                                 "library_ai_daily_global": 0}], indirect=True)
async def test_suggest_with_the_site_budget_spent_is_429_busy(app, client, auth_headers, monkeypatch):
    item = await make_item(app, await user_id_of(app), five_lines())
    fake_llm(monkeypatch, "1. A")
    r = await client.post(f"/api/dubbing/items/{item}/roles/suggest", headers=auth_headers,
                          json={"seg_from": 0, "seg_to": 0})
    assert r.status_code == 429 and r.json() == {"error": "AI is busy today"}


@pytest.mark.parametrize("settings_overrides", [{"library_ai_enabled": True, "upstream_llm_base_url": LLM_BASE}],
                         indirect=True)
async def test_an_upstream_failure_is_503(app, client, auth_headers, monkeypatch):
    item = await make_item(app, await user_id_of(app), five_lines())
    fake_llm(monkeypatch, exc=llm.LlmUnavailable("http", 502))
    r = await client.post(f"/api/dubbing/items/{item}/roles/suggest", headers=auth_headers,
                          json={"seg_from": 0, "seg_to": 0})
    assert r.status_code == 503 and r.json() == {"error": "AI is unavailable"}
