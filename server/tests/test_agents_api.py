"""/api/agents 的配置、角色、举报与设置(spec §4.5;计划 R-C16、R-C24、R-C25)。"""
from sqlalchemy import select

from app.agents.personas import builtin_personas
from app.models import AgentPersonaReport
from tests.agents_helpers import enable_agents

PERSONA = {"name": "Tom", "intro": "A cat", "prompt": "You are Tom the cat.", "prompt_public": False}


async def register(client, name: str) -> dict:
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_everything_but_config_is_404_when_disabled(client, auth_headers):
    assert (await client.get("/api/agents/config", headers=auth_headers)).json() == {"enabled": False}
    for method, path, body in (
            ("GET", "/api/agents/personas", None), ("POST", "/api/agents/personas", PERSONA),
            ("GET", "/api/agents/personas/builtin:coach", None), ("PATCH", "/api/agents/personas/builtin:coach", {}),
            ("DELETE", "/api/agents/personas/builtin:coach", None),
            ("POST", "/api/agents/personas/builtin:coach/report", {"reason": "spam"}),
            ("GET", "/api/agents/settings", None), ("PATCH", "/api/agents/settings", {})):
        r = await client.request(method, path, headers=auth_headers, json=body)
        assert (r.status_code, r.json()) == (404, {"error": "Agents are disabled"}), path


async def test_config_when_enabled(app, client, auth_headers):
    enable_agents(app, agents_personas_max=3)
    body = (await client.get("/api/agents/config", headers=auth_headers)).json()
    assert body["enabled"] is True and body["available"] is True and body["tools_mode"] == "prefetch"
    assert body["limits"] == {"personas_max": 3, "prompt_max_chars": 800, "history_max": 20, "text_max_chars": 2000}
    assert body["levels"] == ["A2", "B1", "B2", "C1"] and "lookup" in body["tools"]
    assert body["rooms"] is False  # ROOMS_ENABLED is off in tests


async def test_persona_crud_and_visibility(app, client, auth_headers):
    enable_agents(app)
    bob = await register(client, "bob")
    created = await client.post("/api/agents/personas", headers=auth_headers, json=PERSONA)
    assert created.status_code == 200, created.text
    tom = created.json()
    assert (tom["name"], tom["mine"], tom["builtin"], tom["prompt"], tom["prompt_public"]) == (
        "Tom", True, False, "You are Tom the cat.", False)
    listed = (await client.get("/api/agents/personas", headers=auth_headers)).json()["personas"]
    assert [p["id"] for p in listed][:len(builtin_personas())] == [p.id for p in builtin_personas()]
    assert listed[-1]["id"] == tom["id"]
    assert len((await client.get("/api/agents/personas", headers=bob)).json()["personas"]) == len(builtin_personas())
    for method in ("GET", "PATCH", "DELETE"):
        r = await client.request(method, f"/api/agents/personas/{tom['id']}", headers=bob,
                                 json={"name": "x"} if method == "PATCH" else None)
        assert (r.status_code, r.json()) == (404, {"error": "Persona not found"}), method
    patched = await client.patch(f"/api/agents/personas/{tom['id']}", headers=auth_headers,
                                 json={"name": "Tommy", "level": "C1"})
    assert patched.json()["name"] == "Tommy" and patched.json()["level"] == "C1"
    for method in ("PATCH", "DELETE"):
        r = await client.request(method, "/api/agents/personas/builtin:coach", headers=auth_headers,
                                 json={"name": "x"} if method == "PATCH" else None)
        assert (r.status_code, r.json()) == (403, {"error": "Built-in personas are read-only"})
    assert (await client.get("/api/agents/personas/builtin:coach", headers=bob)).json()["prompt"]
    gone = await client.delete(f"/api/agents/personas/{tom['id']}", headers=auth_headers)
    assert gone.json() == {"id": tom["id"]}
    assert (await client.get(f"/api/agents/personas/{tom['id']}", headers=auth_headers)).status_code == 404


async def test_persona_validation_and_cap(app, client, auth_headers):
    enable_agents(app, agents_personas_max=1, agents_prompt_max_chars=100)
    bad = await client.post("/api/agents/personas", headers=auth_headers, json={**PERSONA, "name": ""})
    assert (bad.status_code, bad.json()) == (422, {"error": "Invalid name"})
    long = await client.post("/api/agents/personas", headers=auth_headers, json={**PERSONA, "prompt": "x" * 101})
    assert long.json() == {"error": "Invalid prompt"}
    unknown = await client.post("/api/agents/personas", headers=auth_headers, json={**PERSONA, "owner_id": 1})
    assert unknown.json() == {"error": "Invalid unknown"}
    assert (await client.post("/api/agents/personas", headers=auth_headers, json=PERSONA)).status_code == 200
    capped = await client.post("/api/agents/personas", headers=auth_headers, json=PERSONA)
    assert (capped.status_code, capped.json()) == (429, {"error": "Persona limit reached"})
    bad_id = await client.get("/api/agents/personas/not-an-id", headers=auth_headers)
    assert bad_id.status_code == 422


async def test_report_rules_dedupe_and_daily_cap(app, client, auth_headers, monkeypatch):
    enable_agents(app)
    bob = await register(client, "bob")
    tom = (await client.post("/api/agents/personas", headers=auth_headers, json=PERSONA)).json()
    path = f"/api/agents/personas/{tom['id']}/report"
    assert (await client.post(path, headers=bob, json={"reason": "spam"})).json() == {"ok": True}
    assert (await client.post(path, headers=bob, json={"reason": "other"})).json() == {"ok": True}  # duplicate
    async with app.state.sessionmaker() as s:
        assert [r.reason for r in (await s.scalars(select(AgentPersonaReport))).all()] == ["spam"]
    assert (await client.post(path, headers=auth_headers, json={"reason": "spam"})).status_code == 404  # own
    builtin = await client.post("/api/agents/personas/builtin:coach/report", headers=bob, json={"reason": "spam"})
    assert builtin.status_code == 404
    assert (await client.post(path, headers=bob, json={"reason": "boring"})).status_code == 422
    monkeypatch.setattr("app.routers.agents.REPORTS_DAILY_MAX", 1)
    carol = await register(client, "carol")
    assert (await client.post(path, headers=carol, json={"reason": "spam"})).status_code == 200
    capped = await client.post(path, headers=carol, json={"reason": "spam"})
    assert (capped.status_code, capped.json()) == (429, {"error": "Report limit reached"})


async def test_settings_get_patch_and_validation(app, client, auth_headers):
    enable_agents(app)
    bob = await register(client, "bob")
    first = (await client.get("/api/agents/settings", headers=auth_headers)).json()
    assert first["process_default"] == "collapsed" and first["share_in_rooms"] is True
    saved = await client.patch("/api/agents/settings", headers=auth_headers,
                               json={"share_in_rooms": False, "default_persona_id": "builtin:coach",
                                     "tools": {"lookup": False}})
    assert saved.status_code == 200
    body = saved.json()
    assert body["share_in_rooms"] is False and body["default_persona_id"] == "builtin:coach"
    assert body["tools"]["lookup"] is False and body["tools"]["memory"] is True
    assert (await client.get("/api/agents/settings", headers=auth_headers)).json() == body
    tom = (await client.post("/api/agents/personas", headers=auth_headers, json=PERSONA)).json()
    foreign = await client.patch("/api/agents/settings", headers=bob, json={"default_persona_id": tom["id"]})
    assert (foreign.status_code, foreign.json()) == (422, {"error": "Unknown persona"})
    for patch, error in (({"process_default": "expanded"}, "Invalid process_default"),
                         ({"tools": {"shell": True}}, "Invalid tools"), ({"tutor": {"length": 30}}, "Invalid tutor")):
        r = await client.patch("/api/agents/settings", headers=auth_headers, json=patch)
        assert (r.status_code, r.json()) == (422, {"error": error})
