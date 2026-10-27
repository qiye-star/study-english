"""POST /api/dictionary/lookup payload shapes (spec 2026-10-13-defs-default-lookup-ios §3.2, plan B). The web contract test
web/src/features/lookup/dictionary-contract.test.ts reads the same file key by key.

Re-record: `CONTRACT_UPDATE=1 uv run pytest -q tests/test_dictionary_contract.py`
(PowerShell: `$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_dictionary_contract.py; Remove-Item Env:CONTRACT_UPDATE`).
Separate from wordbook_contract.json on purpose: that file is re-recorded by other work (def_lang default)."""
import json
import os
from pathlib import Path

from tests.test_dictionary_api import ask, login, use_data
from tests.test_web_contract import shape

FIXTURE = Path(__file__).parent / "fixtures" / "dictionary_contract.json"
KEYS = {"hit", "inflected", "phrase", "miss"}


async def test_dictionary_payloads_match_the_web_contract(app, client, tmp_path):
    use_data(app, tmp_path)
    h = await login(client)
    actual = {
        "hit": (await ask(client, h, "talk")).json(),
        "inflected": (await ask(client, h, "went")).json(),
        "phrase": (await ask(client, h, "be able to")).json(),
        "miss": (await ask(client, h, "zebra")).json(),
    }
    assert set(actual) == KEYS
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert shape(actual) == shape(expected)
    for key in ("hit", "inflected", "phrase"):  # shape() only looks at the first list element: pin the lists
        assert expected[key]["hit"] is True and expected[key]["source"] == "dict" and expected[key]["def_lang"] in ("both", "zh", "en")
        assert expected[key]["defs_zh"] and set(expected[key]["defs_zh"][0]) == {"pos", "text"}
    assert expected["hit"]["defs_en"] and set(expected["hit"]["defs_en"][0]) == {"pos", "text"}
    assert expected["hit"]["phrases"] and set(expected["hit"]["phrases"][0]) == {"en", "zh"}
    assert expected["inflected"]["lemma"] == "go" and "lemma" not in expected["hit"] and "phonetic" in expected["hit"]
    assert expected["phrase"]["defs_en"] == [] and "phrases" not in expected["phrase"]
    assert expected["miss"] == {"hit": False}
    raw = FIXTURE.read_text(encoding="utf-8")
    assert "access_token" not in raw and "secret" not in raw and str(tmp_path) not in raw.replace("\\\\", "\\")
