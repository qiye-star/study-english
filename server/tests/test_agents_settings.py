"""用户级智能体设置(spec §4.3;计划 R-C24)。"""
import pytest

from app.agents import settings as S
from app.agents.context import TOOL_KEYS
from app.models import AgentUserSettings, User, utcnow


def test_defaults_output():
    assert S.DEFAULTS.out() == {
        "tools": {k: True for k in TOOL_KEYS}, "memory_enabled": True, "share_in_rooms": True, "show_process": True,
        "default_persona_id": None, "tutor": {"length": 8, "mix": list(S.TUTOR_KINDS)}, "zh_note": "auto", "process_default": "collapsed"}


def test_merge_strict_and_lenient():
    out = S.merge(S.DEFAULTS, {"tools": {"lookup": False}, "tutor": {"length": 5}}, strict=True)
    assert out.tools["lookup"] is False and out.tools["memory"] is True
    assert out.tutor == {"length": 5, "mix": list(S.TUTOR_KINDS)}
    assert S.merge(S.DEFAULTS, {"tutor": {"mix": ["dictate", "ask"]}}, strict=True).tutor["mix"] == ["ask", "dictate"]
    lenient = S.merge(S.DEFAULTS, {"show_process": "nope", "bogus": 1, "memory_enabled": False}, strict=False)
    assert lenient.show_process is True and lenient.memory_enabled is False


@pytest.mark.parametrize("patch,field", [
    ({"tools": {"shell": True}}, "tools"),
    ({"tools": {"lookup": "yes"}}, "tools"),
    ({"memory_enabled": 1}, "memory_enabled"),
    ({"default_persona_id": "nope"}, "default_persona_id"),
    ({"tutor": {"length": 2}}, "tutor"),
    ({"tutor": {"length": 13}}, "tutor"),
    ({"tutor": {"mix": []}}, "tutor"),
    ({"tutor": {"mix": ["sing"]}}, "tutor"),
    ({"tutor": {"speed": 1}}, "tutor"),
    ({"process_default": "expanded"}, "process_default"),
    ({"zh_note": "sometimes"}, "zh_note"),
    ({"zh_note": 1}, "zh_note"),
    ({"whatever": True}, "unknown"),
])
def test_strict_merge_rejects(patch, field):
    with pytest.raises(S.SettingsInvalid) as err:
        S.merge(S.DEFAULTS, patch, strict=True)
    assert err.value.field == field


async def test_load_and_save_round_trip(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=10000001, username="u", password_hash="x"))
        await s.commit()
        assert await S.load(s, 10000001) == S.DEFAULTS
        saved = await S.save(s, 10000001, {"share_in_rooms": False, "default_persona_id": "builtin:coach"})
        await s.commit()
        assert saved.share_in_rooms is False
        again = await S.save(s, 10000001, {"tools": {"memory": False}})
        await s.commit()
        assert again.share_in_rooms is False and again.tools["memory"] is False
        assert (await S.load(s, 10000001)).default_persona_id == "builtin:coach"


async def test_load_drops_stale_or_broken_keys(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=10000001, username="u", password_hash="x"))
        s.add(AgentUserSettings(user_id=10000001, data={"show_process": False, "tools": {"old_tool": True},
                                                        "tutor": {"length": 99}}, updated_at=utcnow()))
        await s.commit()
        loaded = await S.load(s, 10000001)
        assert loaded.show_process is False and loaded.tools == S.DEFAULTS.tools and loaded.tutor["length"] == 8


def test_zh_note_values_and_lenient_reads():
    from app.agents import lang

    assert S.ZH_NOTES == lang.ZH_SETTINGS
    assert S.merge(S.DEFAULTS, {"zh_note": "never"}, strict=True).zh_note == "never"
    assert S.merge(S.DEFAULTS, {"zh_note": "loud"}, strict=False).zh_note == "auto"  # a stale value is dropped
