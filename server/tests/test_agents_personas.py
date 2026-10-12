"""角色(spec §4.2、§9.1;计划 R-C1、R-C16、R-C23)。"""
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.agents import personas as P
from app.agents.context import TOOL_KEYS
from app.models import AgentPersonaReport, User, utcnow

WEB_SCENARIOS = Path(__file__).resolve().parents[2] / "web" / "src" / "features" / "chat" / "scenarios.ts"


def test_builtins_are_static_public_and_well_formed():
    items = P.builtin_personas()
    ids = [p.id for p in items]
    assert ids == ["builtin:coach", "builtin:partner", "builtin:reviewer", "builtin:interviewer", "builtin:waiter",
                   "builtin:officer", "builtin:receptionist", "builtin:doctor", "builtin:landlord", "builtin:guide",
                   "builtin:friend"]
    for p in items:
        assert p.builtin and p.owner_id is None and p.prompt_public and not p.disabled
        assert 1 <= len(p.name) <= P.NAME_MAX and len(p.intro) <= P.INTRO_MAX and p.prompt.strip()
        assert p.level in P.LEVELS and p.style in P.STYLES and p.tools == TOOL_KEYS
        assert P.ID_RE.fullmatch(p.id)
    assert P.builtin_by_id("builtin:waiter").name == "咖啡店店员" and P.builtin_by_id("builtin:nope") is None


def test_coach_comes_from_the_chat_agent_templates():
    rows = json.loads(P.TEMPLATES.read_text(encoding="utf-8"))
    row = next(r for r in rows if r["key"] == "english-coach")
    coach = P.builtin_by_id("builtin:coach")
    assert coach.name == row["name"] and "纽约" in coach.prompt and "\n " not in coach.prompt


def test_scenario_roles_match_the_web_presets():
    if not WEB_SCENARIOS.is_file():
        pytest.skip("web sources not present")
    text = WEB_SCENARIOS.read_text(encoding="utf-8")
    for key, *_rest, role in P.SCENARIO_PERSONAS:
        assert role in text, key


def test_clean_persona_create_defaults_and_normalisation():
    out = P.clean_persona({"name": "  Tom\n Cat\t", "prompt": "Line one\r\n\r\n\r\n  Line two‮ \x00"},
                          max_prompt_chars=800)
    assert out == {"name": "Tom Cat", "intro": "", "prompt": "Line one\n\nLine two", "level": "B1",
                   "style": "friendly", "voice": None, "tools": list(TOOL_KEYS), "prompt_public": True,
                   "deep_think": False}


@pytest.mark.parametrize("data,field", [
    ({"prompt": "x"}, "name"),
    ({"name": "x"}, "prompt"),
    ({"name": "", "prompt": "x"}, "name"),
    ({"name": "x" * 21, "prompt": "x"}, "name"),
    ({"name": "x", "prompt": "x", "intro": "y" * 61}, "intro"),
    ({"name": "x", "prompt": "y" * 801}, "prompt"),
    ({"name": "x", "prompt": "x", "level": "C2"}, "level"),
    ({"name": "x", "prompt": "x", "style": "rude"}, "style"),
    ({"name": "x", "prompt": "x", "voice": "a b"}, "voice"),
    ({"name": "x", "prompt": "x", "tools": ["shell"]}, "tools"),
    ({"name": "x", "prompt": "x", "prompt_public": "yes"}, "prompt_public"),
    ({"name": "x", "prompt": "x", "owner_id": 1}, "unknown"),
    ("not a dict", "body"),
])
def test_clean_persona_rejects(data, field):
    with pytest.raises(P.PersonaInvalid) as err:
        P.clean_persona(data, max_prompt_chars=800)
    assert err.value.field == field


def test_clean_persona_partial_and_canonical_tool_order():
    out = P.clean_persona({"tools": ["memory", "lookup", "lookup"], "deep_think": True}, max_prompt_chars=800,
                          partial=True)
    assert out == {"tools": ["lookup", "memory"], "deep_think": True}


def test_out_hides_a_private_prompt_from_others():
    p = P.Persona(id="0" * 8 + "-0000-0000-0000-" + "0" * 12, owner_id=7, name="N", intro="", prompt="secret",
                  prompt_public=False)
    assert p.out(7)["prompt"] == "secret" and p.out(7)["mine"] is True
    assert p.out(8)["prompt"] is None and p.out(8)["mine"] is False
    assert P.builtin_by_id("builtin:coach").out(8)["prompt"]


async def _user(session, uid):
    session.add(User(id=uid, username=f"u{uid}", password_hash="x"))
    await session.commit()


async def test_store_crud_visibility_and_reports(app):
    now = utcnow()
    async with app.state.sessionmaker() as s:
        await _user(s, 10000001)
        await _user(s, 10000002)
        store = P.PersonaStore(s)
        clean = P.clean_persona({"name": "Tom", "prompt": "Be Tom."}, max_prompt_chars=800)
        tom = await store.create(10000001, clean, now)
        await s.commit()
        assert [p.id for p in await store.list_for(10000001)][-1] == tom.id
        assert len(await store.list_for(10000002)) == len(P.builtin_personas())
        assert (await store.get(10000001, tom.id)).name == "Tom"
        assert await store.get(10000002, tom.id) is None
        assert (await store.get_shared(tom.id)).owner_id == 10000001
        assert await store.count_owned(10000001) == 1
        assert await store.update(10000002, tom.id, {"name": "Hack"}, now) is None
        assert (await store.update(10000001, tom.id, {"name": "Tommy"}, now)).name == "Tommy"
        assert await store.report(10000001, tom.id, "spam", now) == "not_found"  # own persona
        assert await store.report(10000002, "builtin:coach", "spam", now) == "not_found"
        assert await store.report(10000002, tom.id, "spam", now) == "ok"
        assert await store.report(10000002, tom.id, "other", now) == "duplicate"
        await s.commit()
        assert await store.delete(10000002, tom.id) is False
        assert await store.delete(10000001, tom.id) is True
        await s.commit()
        assert await s.scalar(select(func.count()).select_from(AgentPersonaReport)) == 0
        assert await store.get(10000001, tom.id) is None


def test_builtin_personas_reply_in_english_only():
    assert all("English only" in p.prompt for p in P.builtin_personas())
