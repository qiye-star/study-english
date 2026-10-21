"""The FSRS rollout settings and the two writers that read them (L3 Task 7, plan R9, R10).

Default (wordbook_fsrs_pct = 0): every writer keeps the Leitner boxes. At 100: both writers follow FSRS.
The two entry points (the vocabulary notebook and the wordbook answers) must agree on the engine.
"""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import select, update

from app.core.config import Settings
from app.models import VocabularyItem
from app.services.scheduling import derive_box
from tests.test_wordbook_learn import TALK_MEANING, ans, login, make_due, pin_qtypes

T = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)


def test_fsrs_settings_default_off_and_bounded():
    s = Settings(_env_file=None)
    assert (s.wordbook_fsrs_pct, s.wordbook_fsrs_retention_pct) == (0, 90)
    for bad in ({"wordbook_fsrs_pct": 101}, {"wordbook_fsrs_retention_pct": 84}, {"wordbook_fsrs_retention_pct": 96}):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, **bad)
    assert Settings(_env_file=None, wordbook_fsrs_retention_pct=85).wordbook_fsrs_retention_pct == 85
    assert Settings(_env_file=None, wordbook_fsrs_retention_pct=95).wordbook_fsrs_retention_pct == 95


async def _user(client, name: str) -> dict:
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _vocab_review_good(client, app, headers) -> dict:
    item = (await client.post("/api/vocabulary", headers=headers, json={"word": "orchard", "source": "manual"})).json()
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.id == item["id"])
                        .values(due_at=T - timedelta(hours=1)))
        await s.commit()
    r = await client.post(f"/api/vocabulary/{item['id']}/review", headers=headers, json={"grade": "good"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        row = (await s.execute(select(VocabularyItem.box, VocabularyItem.reps, VocabularyItem.stability)
                               .where(VocabularyItem.id == item["id"]))).one()
    return {"box": row.box, "reps": row.reps, "stability": row.stability}


async def test_vocabulary_review_at_the_default_setting_is_leitner(client, app):
    row = await _vocab_review_good(client, app, await _user(client, "vocab_default"))
    assert row["box"] == 1 and row["reps"] == 1 and row["stability"] is not None


@pytest.mark.parametrize("settings_overrides", [{"wordbook_fsrs_pct": 100}], indirect=True)
async def test_vocabulary_review_at_full_rollout_follows_fsrs(client, app):
    row = await _vocab_review_good(client, app, await _user(client, "vocab_fsrs"))
    assert row["box"] == derive_box(row["stability"]) and row["reps"] == 1


async def _wordbook_good_on_talk(app, client, tmp_path, monkeypatch, **overrides) -> dict:
    h = await login(app, client, tmp_path, **overrides)
    pin_qtypes(monkeypatch, {"talk": "word"})
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)
    await make_due(app, "talk")
    r = (await ans(client, h, key="talk", mode="review", qtype="word", choice="Talk")).json()
    assert r.get("applied") is True and r.get("grade") == "good", r
    async with app.state.sessionmaker() as s:
        row = (await s.execute(select(VocabularyItem.box, VocabularyItem.stability)
                               .where(VocabularyItem.word == "talk"))).one()
    return {"box": row.box, "stability": row.stability}


async def test_wordbook_review_at_the_default_setting_is_leitner(app, client, tmp_path, monkeypatch):
    row = await _wordbook_good_on_talk(app, client, tmp_path, monkeypatch)
    assert row["box"] == 1
    assert row["stability"] is not None  # the shadow state is written even when Leitner decides


async def test_wordbook_review_at_full_rollout_follows_fsrs(app, client, tmp_path, monkeypatch):
    row = await _wordbook_good_on_talk(app, client, tmp_path, monkeypatch, wordbook_fsrs_pct=100)
    assert row["box"] == derive_box(row["stability"])
