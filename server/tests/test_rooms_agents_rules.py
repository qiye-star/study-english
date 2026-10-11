from app.admin.rooms_admin import clean_admin_settings
from app.rooms.protocol import MAX_AGENTS
from app.rooms.rules import clean_settings

U1 = "0b6c1f3e-2a4d-4c5e-9f00-1234567890ab"


def clean(raw):
    return clean_settings(raw, site_max_members=8, partial=True)


def test_agents_shape_is_part_of_the_one_settings_rule():
    assert MAX_AGENTS == 2
    assert clean({"agents": ["builtin:coach", U1]}) == ({"agents": ["builtin:coach", U1]}, {})
    assert clean({"agents": []}) == ({"agents": []}, {})  # clearing is allowed
    for bad, code in (
        (["builtin:coach", "builtin:waiter", "builtin:reviewer"], "too_many"),
        (["builtin:coach", "builtin:coach"], "duplicate"),
        (["coach"], "invalid"), (["BUILTIN:coach"], "invalid"), ("builtin:coach", "invalid"), ([1], "invalid"),
        ([U1.upper()], "invalid"), (["builtin:" + "x" * 40], "invalid"),
    ):
        assert clean({"agents": bad}) == ({}, {"agents": code}), bad


def test_rooms_without_agents_get_the_old_results():
    assert clean({"name": "美食", "ai_public": False}) == ({"name": "美食", "ai_public": False}, {})
    assert clean({"agents": None, "level": "B2"}) == ({"level": "B2"}, {})


def test_operators_cannot_set_agents():
    assert clean_admin_settings({"agents": ["builtin:coach"], "name": "x"}, site_max_members=8) == ({"name": "x"}, {})
