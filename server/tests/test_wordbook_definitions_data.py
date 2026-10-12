"""The committed English-definitions data (spec 2026-10-12-wordbook-definitions §3, §6): checksums, schema, licences, wiring.
Real files; the inputs they were built from are not in the repo, so rebuilding is a manual step (server/scripts/CLAUDE.md)."""
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[1]
ROOT = SERVER.parent
DATA = SERVER / "dictionaries" / "wordbook-definitions"
BOOKS = SERVER / "dictionaries" / "kylebing-english-vocabulary"


def _script():
    spec = importlib.util.spec_from_file_location("wordbook_definitions", SERVER / "scripts" / "wordbook_definitions.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # @dataclass looks the module up by name
    spec.loader.exec_module(module)
    return module


wd = _script()


@pytest.fixture(scope="module")
def rows() -> list[dict]:
    return [json.loads(line) for line in (DATA / "definitions.jsonl").read_text(encoding="utf-8").splitlines()]


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads((DATA / "SOURCE.json").read_text(encoding="utf-8"))


def test_manifest_matches_the_committed_files(manifest):
    assert wd.check(DATA) == []
    assert [i["id"] for i in manifest["inputs"]] == ["oewn", "ecdict", "books"]
    assert manifest["inputs"][0]["sha256"] == wd.INPUTS["oewn"]["sha256"] and manifest["inputs"][1]["license"] == "MIT"
    assert manifest["inputs"][1]["sha256"] == wd.INPUTS["ecdict"]["sha256"]
    assert {f["file"] for f in manifest["files"]} >= {"definitions.jsonl", "missing.txt", "function-words.jsonl"}
    assert max(f["bytes"] for f in manifest["files"]) < 50 * 1024 * 1024
    assert manifest["rules"]["closed_pos_from_wordnet"] is False and manifest["script_version"] == wd.SCRIPT_VERSION


def test_entry_count_and_sources_agree_with_the_manifest(rows, manifest):
    stats = manifest["stats"]
    assert len(rows) == stats["words_with_defs"] and sum(len(r["defs"]) for r in rows) == stats["defs"]
    assert 13_900 <= stats["words_with_oewn"] <= 14_100  # spec §2 measured 13,924 before lemma resolution
    assert stats["words_with_defs"] / stats["words_wanted"] >= 0.95
    by_src = {s: sum(1 for r in rows for d in r["defs"] if d["src"] == s) for s in wd.SRC_VALUES}
    assert by_src["oewn"] > 25_000 and by_src["hand"] >= 60 and by_src["llm"] == stats["pairs"]["llm"]  # the model writes one def per POS


def test_every_row_is_valid_sorted_and_has_a_definition(rows):
    assert wd.definitions_problems(DATA / "definitions.jsonl") == []
    words = [r["word"] for r in rows]
    assert words == sorted(words) and len(set(words)) == len(words)
    for r in rows:
        assert r["defs"] and all(d["text"].strip() and d["pos"] in wd.ALL_POS and d["src"] in wd.SRC_VALUES for d in r["defs"])


def test_at_most_two_definitions_per_part_of_speech(rows):
    for r in rows:
        counts: dict[str, int] = {}
        for d in r["defs"]:
            counts[d["pos"]] = counts.get(d["pos"], 0) + 1
        assert max(counts.values()) <= wd.MAX_PER_POS, r["word"]


def test_keys_are_book_index_keys_and_cover_the_books(rows):
    wanted, _ = wd.collect_wanted(BOOKS)
    keys = {r["word"] for r in rows}
    assert keys <= set(wanted)  # nothing for words no book has
    assert len(keys) / len(wanted) >= 0.95


def test_wordnet_never_supplies_a_closed_class_definition(rows):
    assert not [(r["word"], d["pos"]) for r in rows for d in r["defs"] if d["pos"] in wd.CLOSED_POS and d["src"] == "oewn"]


def test_hand_written_function_words(rows):
    hand = [json.loads(line) for line in (DATA / "function-words.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(hand) >= 60 and [h["word"] for h in hand] == sorted(h["word"] for h in hand)
    for h in hand:
        for d in h["defs"]:
            assert d["src"] == "hand" and d["pos"] in wd.CLOSED_POS and len(d["text"].split()) <= wd.LLM_MAX_WORDS
    got = {r["word"]: r["defs"] for r in rows}
    assert got["in"][0]["src"] == "hand" and got["in"][0]["pos"] == "prep"  # not the WordNet noun (indium)
    assert any(d["pos"] == "art" for d in got["the"]) and any(d["pos"] == "pron" for d in got["it"])
    assert got["an"][0]["pos"] == "art" and got["an"][0]["src"] == "hand"  # the book types it 'indefinite article'
    assert [d["text"] for d in got["abandon"] if d["pos"] == "v"][0] == "forsake, leave behind"


def test_missing_list_has_no_function_word_that_hand_covers_and_is_sorted(manifest):
    lines = (DATA / "missing.txt").read_text(encoding="utf-8").splitlines()
    parsed = [line.split("\t") for line in lines]
    assert all(len(p) == 4 and p[2] in wd.CATEGORIES for p in parsed)
    assert {p[0] for p in parsed}.isdisjoint({"the", "in", "of", "and", "to", "a", "an", "it"})
    order = {c: i for i, c in enumerate(wd.CATEGORIES)}
    assert [order[p[2]] for p in parsed] == sorted(order[p[2]] for p in parsed)
    assert len(parsed) == manifest["stats"]["gaps"]


def test_the_runtime_loader_reads_the_committed_file(rows):
    definitions = pytest.importorskip("app.wordbook.definitions")  # lane R/P; skipped until it has merged
    d = definitions.Definitions(DATA / "definitions.jsonl")
    assert len(d) == len(rows)
    assert d.defs_for("stamp") and all(set(x) == {"pos", "text"} for x in d.defs_for("stamp"))
    assert len(d.defs_for("round")) <= 4 and d.defs_for("zebraxyz") == []


def test_licences_notice_gitattributes_and_docker_wiring():
    oewn = (DATA / "LICENSE-OEWN").read_text(encoding="utf-8")
    assert "Open English WordNet" in oewn and "CC BY 4.0" in oewn and "https://creativecommons.org/licenses/by/4.0/" in oewn
    ecdict = (DATA / "LICENSE-ECDICT").read_text(encoding="utf-8")
    assert "MIT License" in ecdict and "Permission is hereby granted" in ecdict
    copyright_line = next(line.strip() for line in ecdict.splitlines() if line.strip().lower().startswith("copyright"))
    notice = (ROOT / "NOTICE").read_text(encoding="utf-8")
    assert "Open English WordNet" in notice and "Creative Commons Attribution 4.0" in notice
    assert "ECDICT" in notice and "skywind3000" in notice and copyright_line in notice and "Permission is hereby granted" in notice
    assert "KyleBing/english-vocabulary" in notice  # the earlier entry is still there
    attrs = (ROOT / ".gitattributes").read_text(encoding="utf-8")
    assert "server/dictionaries/**/*.jsonl binary" in attrs and "server/dictionaries/wordbook-definitions/*.txt binary" in attrs
    assert "COPY server/dictionaries /app/dictionaries" in (SERVER / "Dockerfile").read_text(encoding="utf-8")
    assert "!server/dictionaries" in (SERVER / "Dockerfile.dockerignore").read_text(encoding="utf-8").splitlines()
    assert (DATA / "CLAUDE.md").is_file()


def test_files_are_lf_without_bom():
    for name in ("definitions.jsonl", "function-words.jsonl", "missing.txt", "SOURCE.json"):
        raw = (DATA / name).read_bytes()
        assert not raw.startswith(b"\xef\xbb\xbf") and b"\r" not in raw and raw.endswith(b"\n"), name
        raw.decode("utf-8")


def test_no_secret_shaped_text_in_the_data_dir():
    pattern = re.compile(r"(sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|api[_-]?key\s*[:=])", re.I)
    for path in DATA.iterdir():
        if path.suffix in {".jsonl", ".txt", ".json", ".md"} or path.name.startswith("LICENSE"):
            assert not pattern.search(path.read_text(encoding="utf-8")), path.name
