from datetime import datetime, timedelta, timezone

import pytest

from app.core.quotas import QUOTA_KEYS, overrides_for, quota_for
from app.models import User, UserQuotaOverride

NOW = datetime(2026, 10, 9, 9, 0, tzinfo=timezone.utc)


def test_quota_keys_map_to_settings_fields(app):
    for key, field in QUOTA_KEYS.items():
        assert hasattr(app.state.settings, field), key


async def test_quota_falls_back_to_settings_and_honours_expiry(app):
    s = app.state.settings
    async with app.state.sessionmaker() as session:
        session.add(User(id=12345678, username="alice", password_hash="x"))
        await session.commit()
        assert await quota_for(session, s, 12345678, "max_conversations", NOW) == s.max_conversations
        session.add_all([
            UserQuotaOverride(user_id=12345678, key="max_conversations", value=999, updated_by="root", updated_at=NOW),
            UserQuotaOverride(user_id=12345678, key="max_vocab_items", value=5, updated_by="root", updated_at=NOW,
                              expires_at=NOW - timedelta(minutes=1)),
        ])
        await session.commit()
        assert await quota_for(session, s, 12345678, "max_conversations", NOW) == 999
        assert await quota_for(session, s, 12345678, "max_vocab_items", NOW) == s.max_vocab_items  # expired
        assert await overrides_for(session, 12345678, NOW) == {"max_conversations": 999}


async def test_unknown_quota_key_is_an_error(app):
    async with app.state.sessionmaker() as session:
        with pytest.raises(KeyError):
            await quota_for(session, app.state.settings, 1, "nope", NOW)
