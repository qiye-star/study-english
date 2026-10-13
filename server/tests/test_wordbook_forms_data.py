"""The committed word-form table forms.txt (spec 2026-10-13-defs-default-lookup-ios §3.2): checksums, schema, coverage,
wiring, and the real files answering real lookups. The ECDICT input it was built from is not in the repo, so rebuilding
is a manual step (server/scripts/CLAUDE.md)."""
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

from app.wordbook.forms import FILE_NAME, Forms
from app.wordbook.index import DictionaryStore
from app.wordbook.lookup import DictionaryLookup

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
def pairs() -> dict[str, str]:
    rows = (DATA / FILE_NAME).read_bytes().decode("utf-8").split("\n")
    return dict(line.split("\t") for line in rows if line)


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads((DATA / "SOURCE.json").read_text(encoding="utf-8"))


def test_the_manifest_lists_the_file_and_the_checks_pass(manifest):
    assert wd.check(DATA) == []
    entry = next(f for f in manifest["files"] if f["file"] == "forms.txt")
    assert entry["sha256"] == wd.sha256_of(DATA / "forms.txt") and entry["bytes"] == (DATA / "forms.txt").stat().st_size
    assert entry["entries"] == manifest["forms"]["forms"] and manifest["files"][-1] is entry
    assert manifest["forms"]["version"] == wd.FORMS_VERSION and manifest["forms"]["kinds"] == list(wd.FORM_KINDS)
    assert manifest["forms"]["skips_book_headword_forms"] is True


def test_the_size_stays_small(manifest):
    entry = next(f for f in manifest["files"] if f["file"] == "forms.txt")
    assert 18_000 <= entry["entries"] <= 24_000  # measured 21,074 forms for 11,537 lemmas on 2026-10-13
    assert entry["bytes"] < 1024 * 1024  # measured 361,197


def test_every_lemma_is_a_book_headword_and_no_form_is(pairs):
    wanted, _ = wd.collect_wanted(BOOKS)
    assert set(pairs.values()) <= set(wanted)
    assert not set(pairs) & set(wanted)
    assert len(set(pairs.values())) >= 10_000  # most of the 14.6k headwords have at least one form


@pytest.mark.parametrize("form, lemma", [
    ("went", "go"), ("children", "child"), ("stopped", "stop"), ("studies", "study"), ("ran", "run"), ("geese", "goose"),
    ("does", "do"), ("said", "say"), ("dogs", "dog"), ("fastest", "fast"), ("leaves", "leave"), ("axes", "axis"),
])
def test_known_pairs(pairs, form, lemma):
    assert pairs[form] == lemma


def test_headword_forms_are_not_in_the_table(pairs):
    assert not {"running", "left", "better", "saw"} & set(pairs)  # each is a word-book headword: found directly


def test_the_runtime_loader_reads_the_committed_file(pairs):
    forms = Forms(DATA / FILE_NAME)
    assert len(forms) == len(pairs) and forms.lemma_of("went") == "go" and forms.lemma_of("zebraxyz") is None


async def test_real_files_answer_real_lookups():
    lookup = DictionaryLookup(DictionaryStore(BOOKS))
    went = await lookup.lookup("Went")
    assert went["word"] == "went" and went["lemma"] == "go" and went["source"] == "dict" and went["defs_zh"] and went["defs_en"]
    assert (await lookup.lookup("children"))["lemma"] == "child"
    direct = await lookup.lookup("country")
    assert direct["word"].lower() == "country" and "lemma" not in direct and direct["defs_zh"] and direct["defs_en"]
    assert await lookup.lookup("zebraxyz") is None and await lookup.lookup("ask not what your country can do") is None
    phrase = await lookup.lookup("look up")
    assert phrase is not None and phrase["defs_zh"]


def test_the_file_is_lf_without_bom():
    raw = (DATA / "forms.txt").read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf") and b"\r" not in raw and raw.endswith(b"\n")
    raw.decode("utf-8")


def test_notice_gitattributes_and_docker_wiring():
    notice = (ROOT / "NOTICE").read_text(encoding="utf-8")
    assert "forms.txt" in notice and "skywind3000" in notice and "Permission is hereby granted" in notice
    attrs = (ROOT / ".gitattributes").read_text(encoding="utf-8")
    assert "server/dictionaries/wordbook-definitions/*.txt binary" in attrs  # forms.txt is checksummed: no EOL conversion
    assert "COPY server/dictionaries /app/dictionaries" in (SERVER / "Dockerfile").read_text(encoding="utf-8")
    assert "!server/dictionaries" in (SERVER / "Dockerfile.dockerignore").read_text(encoding="utf-8").splitlines()


def test_no_secret_shaped_text_in_the_file():
    pattern = re.compile(r"(sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|api[_-]?key\s*[:=])", re.I)
    assert not pattern.search((DATA / "forms.txt").read_text(encoding="utf-8"))
