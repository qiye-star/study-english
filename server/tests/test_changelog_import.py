"""更新日志草稿导入命令(计划 2026-10-14-changelog S4;spec D5、§2.1):幂等、只建草稿、全有或全无、不打印标题。"""
import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app.admin import changelog_import
from app.models import AdminAudit, ChangelogEntry
from tests.admin_helpers import ADMIN_ENABLED, login_as

MARK = "ZQMARKER-IMPORT"
REPO = Path(__file__).resolve().parents[2]
SERVER = Path(__file__).resolve().parents[1]
INTERNAL_WORDS = ("migration", "alembic", "worktree", "sqlite", "postgres", "docker", "localhost", "api key", "token",
                  "secret", "endpoint", "uvicorn")


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED}


def use_db(app, monkeypatch):
    monkeypatch.setattr(changelog_import, "_sessionmaker", lambda: app.state.sessionmaker)


def entry(day: str, title: str, *, text: str = "一句话", **over) -> dict:
    base = {"entry_date": day, "version": None, "title_zh": title, "title_en": f"{title} (en)",
            "items": [{"tag": "new", "zh": text, "en": "one sentence"}]}
    return {**base, **over}


def write(directory: Path, name: str, entries) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")


async def rows(app) -> list[ChangelogEntry]:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(ChangelogEntry).order_by(ChangelogEntry.id))).all())


async def test_import_creates_drafts_once_in_date_order(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-12", "B 标题"), entry("2026-10-11", "A 标题")])
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 2, skipped 0"
    got = await rows(app)
    assert [(r.entry_date.isoformat(), r.title_zh) for r in got] == [("2026-10-11", "A 标题"), ("2026-10-12", "B 标题")]
    assert all(r.published_at is None and r.archived_at is None and r.created_by == "import" for r in got)
    assert got[0].items == [{"tag": "new", "zh": "一句话", "en": "one sentence"}] and got[0].version is None
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 0, skipped 2"
    assert len(await rows(app)) == 2


async def test_a_published_edited_or_deleted_entry_is_never_touched_again(app, client, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "A"), entry("2026-10-12", "B"), entry("2026-10-13", "C")])
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    a, b, c = [r.id for r in await rows(app)]
    h = await login_as(app, client, "operator")
    assert (await client.post(f"/api/admin/changelog/{a}/publish", headers=h)).status_code == 200
    assert (await client.delete(f"/api/admin/changelog/{b}", headers=h)).status_code == 200
    assert (await client.patch(f"/api/admin/changelog/{c}", headers=h, json={"title_en": "Edited"})).status_code == 200
    write(tmp_path, "a.json", [entry("2026-10-11", "A", text="改过的内容"), entry("2026-10-12", "B"),
                               entry("2026-10-13", "C", text="又改了")])
    capsys.readouterr()
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 0, skipped 3"
    state = {r.id: r for r in await rows(app)}
    assert len(state) == 3
    assert state[a].published_at is not None and state[a].items[0]["zh"] == "一句话"  # still published, text untouched
    assert state[b].archived_at is not None  # a deleted draft is not revived
    assert state[c].title_en == "Edited" and state[c].items[0]["zh"] == "一句话"


async def test_a_renamed_title_is_a_new_draft(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "旧标题")])
    await changelog_import.run(["--dir", str(tmp_path)])
    write(tmp_path, "a.json", [entry("2026-10-11", "新标题")])
    capsys.readouterr()
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 1, skipped 0"
    assert sorted(r.title_zh for r in await rows(app)) == ["新标题", "旧标题"]


async def test_the_same_key_in_two_files_is_created_once(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "A")])
    write(tmp_path, "b.json", [entry("2026-10-11", "A", text="另一个文件里的同一条")])
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 1, skipped 1"
    assert len(await rows(app)) == 1


async def test_dry_run_writes_nothing(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "A"), entry("2026-10-12", "B")])
    assert await changelog_import.run(["--dir", str(tmp_path), "--dry-run"]) == 0
    assert capsys.readouterr().out.strip() == "would create 2, skipped 0"
    assert await rows(app) == []


async def test_an_invalid_entry_stops_everything_and_prints_no_text(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "OK")])
    write(tmp_path, "b.json", [entry("2026-10-12", "Bad", text=MARK * 100)])  # 1500 characters
    (tmp_path / "c.json").write_text("{not json " + MARK, encoding="utf-8")
    (tmp_path / "d.json").write_text(json.dumps({"oops": MARK}), encoding="utf-8")
    write(tmp_path, "e.json", [{**entry("2026-10-13", MARK), "surprise": 1}])
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 2
    captured = capsys.readouterr()
    text = captured.out + captured.err
    assert MARK not in text
    for expected in ("b.json[0]", "c.json", "d.json", "e.json[0]", "nothing was imported"):
        assert expected in text
    assert await rows(app) == []  # all or nothing: the valid file was not imported either


async def test_a_missing_directory_exits_with_one(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    assert await changelog_import.run(["--dir", str(tmp_path / "nope")]) == 1
    assert "not found" in capsys.readouterr().err


async def test_an_empty_directory_imports_nothing(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 0, skipped 0"


async def test_the_import_is_audited_by_the_cli_with_ids_only(app, monkeypatch, tmp_path):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "A"), entry("2026-10-12", "B")])
    await changelog_import.run(["--dir", str(tmp_path)])
    async with app.state.sessionmaker() as s:
        audits = list((await s.scalars(select(AdminAudit).where(AdminAudit.action == "changelog.import")
                                       .order_by(AdminAudit.id))).all())
    ids = [str(r.id) for r in await rows(app)]
    assert [a.target_id for a in audits] == ids
    assert all((a.actor, a.target_type, a.summary, a.before, a.after) == ("cli", "changelog", "", None, None) for a in audits)


def test_the_default_directory_is_the_checkout_drafts_folder():
    assert changelog_import.default_dir() == REPO / "docs" / "changelog"


def test_the_repo_drafts_are_valid_and_in_plain_words():
    directory = changelog_import.default_dir()
    assert directory is not None
    drafts = changelog_import.load_dir(directory)
    assert len(drafts) >= 6
    keys = [(v["entry_date"], v["title_zh"]) for _file, _index, v in drafts]
    assert len(keys) == len(set(keys))
    assert all(len(v["items"]) <= 4 for _file, _index, v in drafts)  # the drafting rule in docs/CLAUDE.md
    assert all(v["title_en"] and all(i["en"] for i in v["items"]) for _file, _index, v in drafts)  # English users are not left on Chinese
    text = " ".join([v["title_zh"] + " " + v["title_en"] + " " + " ".join(i["zh"] + " " + i["en"] for i in v["items"])
                     for _file, _index, v in drafts]).lower()
    for word in INTERNAL_WORDS:
        assert word not in text, word


async def test_the_repo_drafts_import_into_an_empty_database_once(app, monkeypatch, capsys):
    use_db(app, monkeypatch)
    assert await changelog_import.run([]) == 0
    created = int(capsys.readouterr().out.split()[1].rstrip(","))
    assert created >= 6 and len(await rows(app)) == created
    assert await changelog_import.run([]) == 0
    assert capsys.readouterr().out.startswith("created 0,")
    assert len(await rows(app)) == created


def test_the_image_ships_the_drafts():
    assert "COPY docs/changelog /app/changelog" in (SERVER / "Dockerfile").read_text(encoding="utf-8").splitlines()
    assert "!docs/changelog" in (SERVER / "Dockerfile.dockerignore").read_text(encoding="utf-8").splitlines()
