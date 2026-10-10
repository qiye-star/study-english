from datetime import datetime, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.core import metering
from app.core.quotas import QUOTA_KEYS
from app.core.settings_registry import SPECS
from app.models import User, WordbookEnrollment, WordbookEvent, WordbookExplanation
from tests.conftest import make_settings
from tests.wordbook_helpers import enable_wordbook, make_data_dir

NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)


async def test_enrollment_primary_key_and_event_row(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=10000007, username="lily", password_hash="x"))
        s.add(WordbookEnrollment(user_id=10000007, book_id="cet4", status="active", order_mode="shuffle", seed=42,
                                 cursor=0, daily_new=20, review_cap=100, started_at=NOW, updated_at=NOW))
        s.add(WordbookEvent(user_id=10000007, book_id="cet4", kind="learn", word="absorb", item_id=None,
                            qtype="meaning", outcome="good", credit=100, day="2026-10-10", created_at=NOW))
        s.add(WordbookExplanation(word="absorb", body="…", model="m", prompt_version=None, created_at=NOW))
        await s.commit()
        s.add(WordbookEnrollment(user_id=10000007, book_id="cet4", status="paused", order_mode="book", seed=1,
                                 cursor=0, daily_new=20, review_cap=100, started_at=NOW, updated_at=NOW))
        with pytest.raises(IntegrityError):
            await s.commit()


def test_settings_registry_quota_and_metering(app):
    s = app.state.settings
    assert (s.wordbook_enabled, s.wordbook_ai_enabled, s.wordbook_daily_new, s.wordbook_review_cap) == (False, False, 20, 100)
    assert s.wordbook_books == "junior,senior,cet4,cet6,kaoyan,toefl,sat"
    assert s.wordbook_ai_available is False
    assert s.resolved_wordbook_data_dir.name == "kylebing-english-vocabulary"
    assert (s.resolved_wordbook_data_dir / "SOURCE.json").is_file()
    assert s.model_copy(update={"wordbook_enabled": True, "wordbook_ai_enabled": True}).wordbook_ai_available is True
    assert s.resolved_wordbook_ai_model == s.default_llm_model
    assert SPECS["wordbook_enabled"].group == "features" and SPECS["wordbook_ai_enabled"].danger
    assert SPECS["wordbook_data_dir"].env_only and SPECS["wordbook_books"].group == "wordbook"
    assert "wordbook_ai_daily_per_user" in QUOTA_KEYS
    assert metering.feature_for("/api/wordbook/answers") == "wordbook"


def test_wordbook_books_rejects_unknown_ids():
    assert make_settings(wordbook_books="sat, junior").wordbook_books == "sat, junior"
    with pytest.raises(ValidationError):
        make_settings(wordbook_books="junior,gre")


async def test_config_reports_disabled_and_requires_login(client, auth_headers):
    r = await client.get("/api/wordbook/config", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"enabled": False}
    assert (await client.get("/api/wordbook/config")).status_code == 401


async def test_config_when_enabled_lists_enabled_books_with_availability(app, client, auth_headers, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path, ("junior",)), wordbook_books="sat,junior")
    body = (await client.get("/api/wordbook/config", headers=auth_headers)).json()
    assert body["enabled"] is True and body["ai_available"] is False
    assert body["defaults"] == {"daily_new": 20, "review_cap": 100}
    assert [(b["id"], b["available"]) for b in body["books"]] == [("junior", True), ("sat", False)]
    assert body["books"][0] == {"id": "junior", "title_zh": "初中", "title_en": "Junior high", "level": 1,
                                "words": 1987, "available": True}
