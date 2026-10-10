"""goals v2 范围设置(spec 2026-10-11 §10):默认值、硬边界、交叉校验、管理员收窄走审计。"""
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.admin import settings_service as svc
from app.admin.audit import Actor
from app.core.config import WORDBOOK_NEW_BOUNDS, WORDBOOK_REVIEW_BOUNDS
from app.core.runtime_settings import runtime_problems
from app.core.settings_registry import SPECS, effective_bounds
from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED
from tests.conftest import make_settings

ROOT = Actor("root", "superadmin", "s1", "203.0.113.5")
NEW_KEYS = ("wordbook_daily_new_min", "wordbook_daily_new_max", "wordbook_review_cap_min", "wordbook_review_cap_max",
            "wordbook_review_unlimited", "wordbook_bonus_max")


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "settings_encryption_key": Fernet.generate_key().decode()}


def test_defaults_and_hard_bounds():
    s = make_settings()
    assert (s.wordbook_daily_new, s.wordbook_review_cap) == (20, 100)
    assert (s.wordbook_daily_new_min, s.wordbook_daily_new_max, s.wordbook_review_cap_min, s.wordbook_review_cap_max,
            s.wordbook_review_unlimited, s.wordbook_bonus_max) == (1, 200, 10, 1000, True, 50)
    assert WORDBOOK_NEW_BOUNDS == (1, 200) and WORDBOOK_REVIEW_BOUNDS == (10, 1000)
    assert effective_bounds(SPECS["wordbook_daily_new"]) == (1, 200)
    assert effective_bounds(SPECS["wordbook_review_cap"]) == (10, 1000)
    assert effective_bounds(SPECS["wordbook_bonus_max"]) == (0, 200)
    assert all(SPECS[k].group == "wordbook" and SPECS[k].apply == "hot" and not SPECS[k].danger for k in NEW_KEYS)


def test_runtime_problems_cross_check_ranges():
    assert runtime_problems(make_settings()) == []
    assert runtime_problems(make_settings(wordbook_daily_new_max=10)) == [
        "WORDBOOK_DAILY_NEW must be within WORDBOOK_DAILY_NEW_MIN..WORDBOOK_DAILY_NEW_MAX"]
    assert runtime_problems(make_settings(wordbook_review_cap_min=200)) == [
        "WORDBOOK_REVIEW_CAP must be within WORDBOOK_REVIEW_CAP_MIN..WORDBOOK_REVIEW_CAP_MAX"]


async def test_admin_narrowing_is_audited_and_inverted_ranges_are_rejected(app):
    async with app.state.sessionmaker() as s:
        result = await svc.save(s, app, ROOT, {"wordbook_daily_new_max": 50, "wordbook_review_unlimited": False},
                                reason="smaller plans")
    assert sorted(result.changed) == ["wordbook_daily_new_max", "wordbook_review_unlimited"]
    assert (app.state.settings.wordbook_daily_new_max, app.state.settings.wordbook_review_unlimited) == (50, False)
    async with app.state.sessionmaker() as s:
        audit = (await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all()
    assert audit[-1].action == "settings.update" and "wordbook_daily_new_max" in audit[-1].target_id
    async with app.state.sessionmaker() as s:
        with pytest.raises(svc.SettingsError) as err:
            await svc.save(s, app, ROOT, {"wordbook_daily_new_min": 60})  # 下限 > 默认 20 且 > 上限 50
    assert err.value.status == 422
