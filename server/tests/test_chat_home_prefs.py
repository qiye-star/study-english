"""Chat-home prefs and settings (plan 2026-10-23 S2, §4)."""
import pytest

from app.agents.greeting import prefs as P
from app.core.config import Settings
from app.core.settings_registry import SPECS
from app.models import ChatPrefs, User, utcnow


def test_defaults():
    assert P.DEFAULTS.out() == {"greeting_trigger": "daily", "language": "bilingual",
                                "daily_persona_id": "builtin:partner", "include_stats": True}


def test_merge_drops_bad_keys_when_lenient():
    out = P.merge(P.DEFAULTS, {"language": "fr", "bogus": 1, "include_stats": False, "greeting_trigger": "off"},
                  strict=False)
    assert out.language == "bilingual" and out.include_stats is False and out.greeting_trigger == "off"


@pytest.mark.parametrize("patch,field", [
    ({"greeting_trigger": "weekly"}, "greeting_trigger"),
    ({"language": "fr"}, "language"),
    ({"language": 1}, "language"),
    ({"include_stats": "yes"}, "include_stats"),
    ({"include_stats": 1}, "include_stats"),
    ({"daily_persona_id": "no way"}, "daily_persona_id"),
    ({"daily_persona_id": None}, "daily_persona_id"),
    ({"zhNote": "always"}, "unknown"),
])
def test_strict_merge_rejects_with_the_field_name(patch, field):
    with pytest.raises(P.PrefsInvalid) as err:
        P.merge(P.DEFAULTS, patch, strict=True)
    assert err.value.field == field


def test_persona_id_format():
    assert P.merge(P.DEFAULTS, {"daily_persona_id": "builtin:coach"}, strict=True).daily_persona_id == "builtin:coach"


async def test_load_and_save_round_trip(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=10000001, username="u", password_hash="x"))
        await s.commit()
        assert await P.load(s, 10000001) == P.DEFAULTS
        saved = await P.save(s, 10000001, {"language": "zh"})
        await s.commit()
        assert saved.language == "zh"
        again = await P.save(s, 10000001, {"include_stats": False})
        await s.commit()
        assert again.language == "zh" and again.include_stats is False
        with pytest.raises(P.PrefsInvalid):
            await P.save(s, 10000001, {"language": "xx"})
        with pytest.raises(P.PrefsInvalid):
            await P.save(s, 10000001, ["language"])
        assert (await P.load(s, 10000001)).language == "zh"


async def test_load_drops_stale_or_broken_keys(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=10000002, username="v", password_hash="x"))
        s.add(ChatPrefs(user_id=10000002, data={"language": "xx", "greeting_trigger": "every_open", "old": 1},
                        updated_at=utcnow()))
        await s.commit()
        got = await P.load(s, 10000002)
        assert got.greeting_trigger == "every_open" and got.language == "bilingual"


def test_chat_home_settings_defaults_and_registry():
    s = Settings(_env_file=None)
    assert (s.chat_home_enabled, s.chat_greeting_llm_enabled, s.chat_greeting_timeout_seconds,
            s.chat_greeting_global_daily) == (False, True, 6, 2000)
    assert s.resolved_chat_greeting_model == s.default_llm_model
    assert Settings(_env_file=None, agents_model="m1").resolved_chat_greeting_model == "m1"
    assert Settings(_env_file=None, agents_model="m1", chat_greeting_model=" m2 ").resolved_chat_greeting_model == "m2"
    keys = {k for k in Settings.model_fields if k.startswith(("chat_home_", "chat_greeting_"))}
    assert keys and all(SPECS[k].group == "chat_home" for k in keys)
