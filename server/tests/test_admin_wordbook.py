"""管理端词书页(计划 2026-10-10-wordbook A1;spec §9)。

Ruling A1-T1: 学习者端点(S 车道)不在本分支上,这里直接写库造数据(选书、学新词事件、词书行、举报),
例句 id 取自 `dictionary(app).card(...)`,与 S4 的 `/cards` 和 `/reports` 写入同一张表、同一个 id。"""
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.admin.doctor import CODES, diagnose
from app.models import (AdminAudit, DailyUsage, User, VocabularyItem, WordbookEnrollment, WordbookEvent,
                        WordbookHiddenSentence, WordbookReport, utcnow)
from app.wordbook.index import dictionary
from tests.admin_helpers import ADMIN_ENABLED, assert_no_secrets, login_as
from tests.conftest import make_settings
from tests.test_admin_doctor import OK
from tests.wordbook_helpers import enable_wordbook, make_data_dir

API = "/api/admin/wordbook"
UID = 10000042


@pytest.fixture
def settings_overrides():
    return ADMIN_ENABLED


async def learner(app, tmp_path):
    """一个选了 junior 的用户:学会 talk(盒 0)、掌握 carry(盒 5),举报 talk 的第一条例句。"""
    enable_wordbook(app, make_data_dir(tmp_path), wordbook_books="junior,senior")
    card = await dictionary(app).card("junior", "talk")
    now = utcnow()
    async with app.state.sessionmaker() as s:
        s.add(User(id=UID, username="alice", password_hash="x"))
        s.add(WordbookEnrollment(user_id=UID, book_id="junior", status="active", order_mode="book", seed=1,
                                 cursor=2, daily_new=20, review_cap=100, started_at=now, updated_at=now))
        s.add(WordbookEvent(user_id=UID, book_id="junior", kind="learn", word="talk", item_id=None, qtype="meaning",
                            outcome="good", credit=100, day=now.date().isoformat(), created_at=now))
        s.add(WordbookEvent(user_id=UID, book_id="junior", kind="review", word="carry", item_id=None, qtype="meaning",
                            outcome="good", credit=100, day=now.date().isoformat(), created_at=now))
        for word, box in (("talk", 0), ("carry", 5)):
            s.add(VocabularyItem(user_id=UID, word=word, source="wordbook:junior", box=box, due_at=now, reps=0,
                                 lapses=0, created_at=now))
        s.add(VocabularyItem(user_id=UID, word="mine", source="manual", box=5, due_at=now, reps=0, lapses=0,
                             created_at=now))
        s.add(WordbookReport(user_id=UID, book_id="junior", word="talk", sentence_id=card.examples[0].id,
                             kind="sentence", reason="wrong", status="open", created_at=now))
        s.add(DailyUsage(scope="wordbook_ai_global", subject="all", day=now.date().isoformat(), count=7))
        await s.commit()
    return card


async def test_overview_lists_books_files_and_learning(app, client, tmp_path):
    await learner(app, tmp_path)
    await login_as(app, client, "viewer")
    r = await client.get(API)
    assert r.status_code == 200, r.text
    body = r.json()
    junior, senior = body["books"]
    assert (junior["id"], junior["title_zh"], junior["enabled"], junior["learners"], junior["learners_7d"],
            junior["learned"], junior["mastered"], junior["reports_open"]) == ("junior", "初中", True, 1, 1, 1, 1, 1)
    assert junior["file"]["bytes"] > 0 and junior["file"]["sha256_ok"] is None  # 测试数据不在清单里:不判定
    assert junior["index"]["loaded"] is True and junior["index"]["keys"] == 14 and junior["index"]["dropped"] == 2
    assert junior["index"]["stale"] is False and isinstance(junior["index"]["built_ms"], int)
    assert senior["file"]["bytes"] == 0 and senior["index"]["loaded"] is False and senior["learners"] == 0
    assert [b["id"] for b in body["books"]] == ["junior", "senior"]  # 只列启用的书
    assert body["enabled"] is True
    assert body["ai"] == {"enabled": False, "available": False, "today_calls": 7, "global_daily": 200, "cached": 0}
    assert str(tmp_path) not in r.text  # 不返回文件绝对路径
    assert_no_secrets(body, app.state.settings)


async def test_overview_checks_sha256_against_manifest(app, client, tmp_path):
    import hashlib
    import json
    data_dir = make_data_dir(tmp_path)
    good = hashlib.sha256((data_dir / "junior.jsonl").read_bytes()).hexdigest()
    (data_dir / "SOURCE.json").write_text(json.dumps({"books": [
        {"file": "junior.jsonl", "sha256": good}, {"file": "senior.jsonl", "sha256": "0" * 64}]}), encoding="utf-8")
    (data_dir / "senior.jsonl").write_bytes(b"{}\n")
    enable_wordbook(app, data_dir, wordbook_books="junior,senior")
    await login_as(app, client, "viewer")
    books = (await client.get(API)).json()["books"]
    assert [b["file"]["sha256_ok"] for b in books] == [True, False]


async def test_overview_requires_admin(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    assert (await client.get(API)).status_code in (401, 403)


async def test_reload_requires_operator_and_is_audited(app, client, tmp_path):
    await learner(app, tmp_path)
    viewer = await login_as(app, client, "viewer", "viewer2")
    assert (await client.post(f"{API}/reload", headers=viewer, json={"reason": "x"})).status_code == 403
    h = await login_as(app, client, "operator")
    assert (await client.post(f"{API}/reload", headers=h, json={"book_id": "nope", "reason": "x"})).status_code == 422
    assert (await client.post(f"{API}/reload", headers=h, json={"reason": "  "})).status_code == 422
    r = await client.post(f"{API}/reload", headers=h, json={"book_id": "junior", "reason": "数据更新"})
    assert r.status_code == 200 and dictionary(app).loaded() == {}
    async with app.state.sessionmaker() as s:
        row = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "wordbook.reload"))).one()
        assert (row.target_id, row.reason) == ("junior", "数据更新")


async def test_reload_happens_only_after_its_audit_record_commits(app, tmp_path):
    """Review m9: audit before effect, like the other admin actions."""
    from app.admin import wordbook_admin
    from app.admin.audit import CLI_ACTOR

    enable_wordbook(app, make_data_dir(tmp_path))
    await dictionary(app).index("junior")
    async with app.state.sessionmaker() as s:
        async def broken_commit():
            raise RuntimeError("commit failed")

        s.commit = broken_commit
        with pytest.raises(RuntimeError):
            await wordbook_admin.reload(s, app, CLI_ACTOR, book_id="junior", reason="r")
    assert set(dictionary(app).loaded()) == {"junior"}


async def test_hide_sentence_updates_reports_and_live_cards(app, client, tmp_path):
    card = await learner(app, tmp_path)
    viewer = await login_as(app, client, "viewer")
    (row,) = (await client.get(f"{API}/reports")).json()["reports"]
    assert row["sentence"] == card.examples[0].en and row["count"] == 1 and row["word"] == "talk"
    assert row["sentence_id"] == card.examples[0].id and row["reason"] == "wrong" and row["book_id"] == "junior"
    assert (await client.post(f"{API}/reports/{row['id']}/hide", headers=viewer,
                              json={"reason": "x"})).status_code == 403
    h = await login_as(app, client, "operator")
    r = await client.post(f"{API}/reports/{row['id']}/hide", headers=h, json={"reason": "例句不当"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(WordbookHiddenSentence.sentence_id))).all() == [card.examples[0].id]
        assert (await s.scalars(select(WordbookReport.status))).all() == ["hidden"]
        assert "wordbook.sentence.hide" in (await s.scalars(select(AdminAudit.action))).all()
    fresh = await dictionary(app).card("junior", "talk")
    assert card.examples[0].id not in [e.id for e in fresh.examples]
    assert (await client.get(f"{API}/reports")).json()["reports"] == []
    assert (await client.post(f"{API}/reports/{row['id']}/dismiss", headers=h,
                              json={"reason": "x"})).status_code == 409
    assert (await client.post(f"{API}/reports/999/dismiss", headers=h, json={"reason": "x"})).status_code == 404
    assert (await client.post(f"{API}/reports/1/bogus", headers=h, json={"reason": "x"})).status_code == 422


async def test_dismiss_closes_every_open_report_of_the_sentence(app, client, tmp_path):
    card = await learner(app, tmp_path)
    async with app.state.sessionmaker() as s:
        s.add(WordbookReport(user_id=None, book_id="junior", word="talk", sentence_id=card.examples[0].id,
                             kind="sentence", reason="other", status="open",
                             created_at=datetime.now(timezone.utc) - timedelta(hours=1)))
        await s.commit()
    h = await login_as(app, client, "operator")
    (row,) = (await client.get(f"{API}/reports")).json()["reports"]
    assert row["count"] == 2
    assert (await client.post(f"{API}/reports/{row['id']}/dismiss", headers=h, json={"reason": "没问题"})).status_code == 200
    async with app.state.sessionmaker() as s:
        assert set((await s.scalars(select(WordbookReport.status))).all()) == {"dismissed"}
        assert (await s.scalars(select(WordbookHiddenSentence))).all() == []
        assert "wordbook.report.dismiss" in (await s.scalars(select(AdminAudit.action))).all()


def test_doctor_findings():
    assert {"wordbook_data_missing", "wordbook_ai_unavailable"} <= set(CODES)
    s = make_settings(wordbook_enabled=True, wordbook_ai_enabled=True, upstream_llm_base_url="")
    found = {f.code: f for f in diagnose(s, replace(OK, wordbook_missing=("toefl",)))}
    assert found["wordbook_data_missing"].level == "error" and "toefl" in found["wordbook_data_missing"].message_zh
    assert found["wordbook_ai_unavailable"].level == "warn"
    off = {f.code for f in diagnose(make_settings(wordbook_enabled=False), replace(OK, wordbook_missing=("toefl",)))}
    assert not {"wordbook_data_missing", "wordbook_ai_unavailable"} & off


async def test_gather_facts_lists_missing_book_files(app, tmp_path):
    from app.admin.doctor import gather_facts
    enable_wordbook(app, make_data_dir(tmp_path), wordbook_books="junior,toefl")
    async with app.state.sessionmaker() as s:
        facts = await gather_facts(s, app)
    assert facts.wordbook_missing == ("toefl",)


async def test_admin_uses_the_learner_store_helpers(app, client, tmp_path, monkeypatch):
    """集成裁定 Z-d:来源串与刷新屏蔽集走 S 车道的 `store.wordbook_source` / `store.load_hidden`,不在管理端另写一份。"""
    from app.wordbook import store
    calls = {"source": [], "hidden": 0}
    real_source, real_load = store.wordbook_source, store.load_hidden

    def source(book_id):
        calls["source"].append(book_id)
        return real_source(book_id)

    async def load_hidden(session, ds):
        calls["hidden"] += 1
        await real_load(session, ds)

    monkeypatch.setattr(store, "wordbook_source", source)
    monkeypatch.setattr(store, "load_hidden", load_hidden)
    card = await learner(app, tmp_path)
    h = await login_as(app, client, "operator")
    junior = (await client.get(API, headers=h)).json()["books"][0]
    assert junior["mastered"] == 1 and "junior" in calls["source"]
    (row,) = (await client.get(f"{API}/reports", headers=h)).json()["reports"]
    assert (await client.post(f"{API}/reports/{row['id']}/hide", headers=h, json={"reason": "x"})).status_code == 200
    assert calls["hidden"] == 1
    assert card.examples[0].id not in [e.id for e in (await dictionary(app).card("junior", "talk")).examples]
