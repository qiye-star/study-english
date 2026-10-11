"""管理端「智能体」(spec §10.2;计划 R-C12、R-C23、R-C26):审核、审计不含内容、计数无内容、探测、体检。
测试经 PersonaStore / limits / orchestrator 直接造数据,不依赖 routers/agents.py(另一车道)。"""
import json
from dataclasses import replace

import pytest
from sqlalchemy import select

from app.admin import doctor
from app.agents import limits
from app.agents.personas import PersonaStore, clean_persona
from app.models import AdminAudit, AgentPersona, AgentPersonaReport, utcnow
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, assert_no_secrets, login_as
from tests.agents_helpers import FakeLLM, make_deps, make_request, run_events, use_fake_llm
from tests.test_admin_doctor import OK
from tests.test_admin_api import register

API = "/api/admin/agents"
PROMPT = "You are Tom. SECRET-PERSONA-TEXT"


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "agents_enabled": True}


async def persona(app, uid: int, name="Tom") -> dict:
    clean = clean_persona({"name": name, "intro": "cat", "prompt": PROMPT}, max_prompt_chars=800)
    async with app.state.sessionmaker() as s:
        row = await PersonaStore(s).create(uid, clean, utcnow())
        await s.commit()
    return {"id": row.id}


async def report(app, persona_id: str, reporter: int, reason: str) -> None:
    async with app.state.sessionmaker() as s:
        assert await PersonaStore(s).report(reporter, persona_id, reason, utcnow()) == "ok"
        await s.commit()


async def test_query_lists_personas_with_prompt_for_moderation(app, client):
    uid, _ = await register(client, "alice")
    tom = await persona(app, uid)
    await persona(app, uid, "Jerry")
    h = await login_as(app, client, "viewer")
    body = (await client.post(f"{API}/personas/query", headers=h, json={"status": "all", "page": 1})).json()
    assert [p["name"] for p in body["items"]] == ["Jerry", "Tom"] and body["next"] is None
    row = body["items"][1]
    assert (row["id"], row["owner"], row["prompt"], row["reports_open"], row["disabled"]) == (
        tom["id"], "alice", PROMPT, 0, False)
    found = (await client.post(f"{API}/personas/query", headers=h, json={"q": "jer", "status": "all"})).json()
    assert [p["name"] for p in found["items"]] == ["Jerry"]
    pct = (await client.post(f"{API}/personas/query", headers=h, json={"q": "100%_", "status": "all"})).json()
    assert pct["items"] == []
    assert_no_secrets(body, app.state.settings)


async def test_disable_restore_with_audit_and_effect_on_turns(app, client):
    uid, _ = await register(client, "alice")
    tom = await persona(app, uid)
    viewer = await login_as(app, client, "viewer")
    denied = await client.post(f"{API}/personas/{tom['id']}/disable", headers=viewer, json={"reason": "spam bot"})
    assert denied.status_code == 403
    h = await login_as(app, client, "operator")
    r = await client.post(f"{API}/personas/{tom['id']}/disable", headers=h, json={"reason": "spam bot"})
    assert r.json() == {"id": tom["id"], "disabled": True}
    again = await client.post(f"{API}/personas/{tom['id']}/disable", headers=h, json={"reason": "spam bot"})
    assert (again.status_code, again.json()) == (409, {"error": "Persona already disabled"})
    await use_fake_llm(app, FakeLLM())
    async with app.state.sessionmaker() as s:
        loaded = await PersonaStore(s).get(uid, tom["id"])
    assert loaded.disabled is True
    deps, _rt = make_deps(app)
    events = await run_events(deps, make_request(uid, loaded))
    assert events[-1].to_dict() == {"code": "disabled"}
    assert (await client.post(f"{API}/personas/{tom['id']}/restore", headers=h,
                              json={"reason": "appeal ok"})).json() == {"id": tom["id"], "disabled": False}
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action.like("agents.%")))).all()
    assert [r.action for r in rows] == ["agents.persona.disable", "agents.persona.restore"]
    dumped = json.dumps([[r.summary, r.before, r.after, r.target_id] for r in rows], ensure_ascii=False)
    assert "SECRET" not in dumped and "Tom" not in dumped and tom["id"] in dumped


async def test_edit_uses_the_shared_validation_and_audits_field_names_only(app, client):
    uid, _ = await register(client, "alice")
    tom = await persona(app, uid)
    h = await login_as(app, client, "operator")
    bad = await client.patch(f"{API}/personas/{tom['id']}", headers=h, json={"reason": "rename", "name": ""})
    assert (bad.status_code, bad.json()) == (422, {"error": "Invalid name"})
    empty = await client.patch(f"{API}/personas/{tom['id']}", headers=h, json={"reason": "rename"})
    assert (empty.status_code, empty.json()) == (422, {"error": "Nothing to update"})
    ok = await client.patch(f"{API}/personas/{tom['id']}", headers=h,
                            json={"reason": "offensive name", "name": "Cat", "prompt": "Be a cat."})
    assert ok.json()["name"] == "Cat" and ok.json()["prompt"] == "Be a cat."
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(AdminAudit).where(AdminAudit.action == "agents.persona.edit"))
    assert row.after == {"fields": ["name", "prompt"]} and "Cat" not in json.dumps(row.after)


async def test_delete_is_superadmin_only(app, client):
    uid, _ = await register(client, "alice")
    tom = await persona(app, uid)
    h = await login_as(app, client, "operator")
    assert (await client.post(f"{API}/personas/{tom['id']}/delete", headers=h, json={"reason": "remove"})).status_code == 403
    h = await login_as(app, client, "superadmin")
    # review #7: a destructive route needs step-up like the other admin deletes
    denied = await client.post(f"{API}/personas/{tom['id']}/delete", headers=h, json={"reason": "remove it"})
    assert (denied.status_code, denied.json()) == (403, {"error": "Step-up required"})
    async with app.state.sessionmaker() as s:
        assert await s.get(AgentPersona, tom["id"]) is not None
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})).status_code == 200
    assert (await client.post(f"{API}/personas/{tom['id']}/delete", headers=h,
                              json={"reason": "remove it"})).json() == {"id": tom["id"]}
    async with app.state.sessionmaker() as s:
        assert await s.get(AgentPersona, tom["id"]) is None


async def test_reports_group_and_resolve(app, client):
    alice, _ = await register(client, "alice")
    bob, _ = await register(client, "bob")
    carol, _ = await register(client, "carol")
    tom = await persona(app, alice)
    for who, reason in ((bob, "spam"), (carol, "offensive")):
        await report(app, tom["id"], who, reason)
    h = await login_as(app, client, "operator")
    reports = (await client.get(f"{API}/reports", headers=h)).json()["reports"]
    assert len(reports) == 1 and reports[0]["count"] == 2 and reports[0]["reasons"] == {"offensive": 1, "spam": 1}
    assert reports[0]["name"] == "Tom" and reports[0]["owner"] == "alice" and reports[0]["disabled"] is False
    done = await client.post(f"{API}/reports/{tom['id']}/resolve", headers=h,
                             json={"action": "disable", "reason": "confirmed spam"})
    assert done.json() == {"persona_id": tom["id"], "resolved": 2, "action": "disable"}
    assert (await client.get(f"{API}/reports", headers=h)).json()["reports"] == []
    async with app.state.sessionmaker() as s:
        assert (await s.get(AgentPersona, tom["id"])).disabled_at is not None
        assert {r.resolution for r in (await s.scalars(select(AgentPersonaReport))).all()} == {"disabled"}
    none = await client.post(f"{API}/reports/{tom['id']}/resolve", headers=h,
                             json={"action": "dismiss", "reason": "x y z w"})
    assert (none.status_code, none.json()) == (404, {"error": "No open reports"})


async def test_overview_has_numbers_only(app, client):
    uid, _ = await register(client, "alice")
    await persona(app, uid)
    async with app.state.sessionmaker() as s:
        assert await limits.consume_turn(s, app, app.state.settings, uid, utcnow()) is None
    await login_as(app, client, "viewer")
    body = (await client.get(API)).json()
    assert body["switches"] == {"enabled": True, "tutor": True, "memory": True, "rooms": True}
    assert body["tools_mode"] == {"configured": "prefetch", "effective": "prefetch", "probe": None}
    assert len(body["usage"]["days"]) == 7 and body["usage"]["turns"][-1] == 1 and body["usage"]["today"]["turns"] == 1
    assert body["personas"] == {"total": 1, "disabled": 0, "reports_open": 0}
    text = json.dumps(body)
    assert "SECRET" not in text and "Tom" not in text and "alice" not in text


async def test_probe_stores_the_result_audits_and_feeds_the_doctor(app, client):
    await use_fake_llm(app, FakeLLM(tool_call={"name": "lookup_word", "arguments": '{"word": "apple"}'}))
    app.state.settings = app.state.settings.model_copy(update={"agents_tools_mode": "native"})
    h = await login_as(app, client, "operator")
    findings = {f["code"] for f in (await client.get("/api/admin/doctor")).json()["findings"]}
    assert "agents_native_unverified" in findings
    r = await client.post(f"{API}/probe-tools", headers=h)
    assert r.json()["ok"] is True and r.json()["code"] == "ok"
    assert app.state.agents_tools_probe["ok"] is True
    assert (await client.get(API)).json()["tools_mode"]["effective"] == "native"
    findings = {f["code"] for f in (await client.get("/api/admin/doctor")).json()["findings"]}
    assert "agents_native_unverified" not in findings
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(AdminAudit).where(AdminAudit.action == "agents.probe.tools"))
    assert row.after == {"ok": True, "code": "ok"}


def test_doctor_findings_are_pure():
    from tests.conftest import make_settings
    s = make_settings(agents_enabled=True, upstream_llm_base_url="")
    assert "agents_unavailable" in {f.code for f in doctor.diagnose(s, OK)}
    s = make_settings(agents_enabled=True, agents_tools_mode="native")
    assert "agents_native_unverified" in {f.code for f in doctor.diagnose(s, OK)}
    assert "agents_native_unverified" not in {f.code for f in doctor.diagnose(s, replace(OK, agents_probe_ok=True))}
    assert {"agents_unavailable", "agents_native_unverified"} <= set(doctor.CODES)
