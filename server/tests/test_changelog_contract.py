"""GET /api/changelog、POST /api/changelog/seen 与管理端条目的载荷形状(spec 2026-10-14-changelog §2.1,计划 S5)。

网页 web/src/features/changelog/changelog-contract.test.ts 与管理端 admin/src/features/changelog/api.test.ts 逐键读同一个夹具。
重录:`CONTRACT_UPDATE=1 uv run pytest -q tests/test_changelog_contract.py`
(PowerShell:`$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_changelog_contract.py; Remove-Item Env:CONTRACT_UPDATE`)。
时间戳固定成 STAMP,重录只会出现真实的形状改动。"""
import json
import os
from pathlib import Path

import pytest

from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.test_web_contract import shape

FIXTURE = Path(__file__).parent / "fixtures" / "changelog_contract.json"
URL = "/api/admin/changelog"
STAMP = "2026-10-14T00:00:00+00:00"
TIME_KEYS = ("published_at", "created_at", "updated_at")
KEYS = {"admin_entry", "admin_list", "empty", "list", "probe", "seen"}
ENTRY_KEYS = {"id", "entry_date", "version", "title_zh", "title_en", "items", "published_at", "is_new"}
ADMIN_KEYS = {"id", "status", "entry_date", "version", "title_zh", "title_en", "items", "created_by", "created_at",
              "updated_at", "published_at"}


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED}


def stable(entry: dict) -> dict:
    return {k: (STAMP if k in TIME_KEYS and v else v) for k, v in entry.items()}


def stable_page(page: dict) -> dict:
    return {**page, "entries": [stable(e) for e in page["entries"]]}


async def test_changelog_payloads_match_the_web_and_admin_contract(app, client, auth_headers):
    admin = await login_as(app, client, "operator")
    empty = (await client.get("/api/changelog", headers=auth_headers)).json()
    ids = []
    for day, version, title in (("2026-10-13", None, "第一条"), ("2026-10-14", "v1.12", "第二条")):
        created = await client.post(URL, headers=admin, json={
            "entry_date": day, "version": version, "title_zh": title, "title_en": f"{title} (en)",
            "items": [{"tag": "new", "zh": "新功能一句话", "en": "A new thing"}, {"tag": "library", "zh": "跟读库一句话", "en": ""}]})
        assert created.status_code == 201, created.text
        ids.append(created.json()["id"])
        assert (await client.post(f"{URL}/{ids[-1]}/publish", headers=admin)).status_code == 200
    listing = (await client.get("/api/changelog", headers=auth_headers)).json()
    probe = (await client.get("/api/changelog", headers=auth_headers, params={"limit": 1})).json()
    seen = (await client.post("/api/changelog/seen", headers=auth_headers, json={"upto_id": ids[-1]})).json()
    admin_list = (await client.get(URL)).json()
    actual = {
        "empty": empty, "list": stable_page(listing), "probe": stable_page(probe), "seen": seen,
        "admin_list": {"entries": [stable(e) for e in admin_list["entries"]]}, "admin_entry": stable(admin_list["entries"][0]),
    }
    assert set(actual) == KEYS
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert shape(actual) == shape(expected)
    # shape() only looks at the first list element and treats every leaf alike: pin the rest by hand
    assert expected["empty"] == {"entries": [], "next": None, "unread": 0, "latest_id": None}
    assert set(expected["list"]) == {"entries", "next", "unread", "latest_id"}
    assert len(expected["list"]["entries"]) == 2 and expected["list"]["next"] is None and expected["list"]["unread"] == 2
    for e in expected["list"]["entries"]:
        assert set(e) == ENTRY_KEYS and isinstance(e["is_new"], bool) and e["published_at"] == STAMP
        assert set(e["items"][0]) == {"tag", "zh", "en"}
    assert {e["version"] for e in expected["list"]["entries"]} == {None, "v1.12"}  # both wire forms of `version`
    assert [e["entry_date"] for e in expected["list"]["entries"]] == ["2026-10-14", "2026-10-13"]  # newest date first
    assert len(expected["probe"]["entries"]) == 1 and expected["probe"]["next"] is not None
    assert expected["seen"] == {"unread": 0, "last_seen_id": 2}
    assert {e["status"] for e in expected["admin_list"]["entries"]} == {"published"}
    assert set(expected["admin_entry"]) == ADMIN_KEYS and expected["admin_entry"]["created_at"] == STAMP
    raw = FIXTURE.read_text(encoding="utf-8")
    assert "access_token" not in raw and "csrf" not in raw.lower() and "password" not in raw.lower()
