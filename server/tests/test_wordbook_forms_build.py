"""The `forms` command of scripts/wordbook_definitions.py (spec 2026-10-13-defs-default-lookup-ios §3.2): the inflected
form -> lemma table built from ECDICT `exchange` data. Fixtures only, no real sources."""
import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

from tests.test_wordbook_definitions_build import make_books, make_ecdict, make_wordnet_zip, run_build

SERVER = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("wordbook_definitions", SERVER / "scripts" / "wordbook_definitions.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # @dataclass looks the module up by name
    spec.loader.exec_module(module)
    return module


wd = _load()

ECDICT_ROWS = [
    ("go", "p:went/d:gone/i:going/3:goes/s:goes", 35), ("went", "0:go/1:p", 0), ("gone", "0:go/1:d", 0),
    ("leaf", "s:leaves/p:leafed", 1559), ("leave", "3:leaves/p:left/d:left/i:leaving", 300), ("leaves", "0:leave/1:3", 0),
    ("axe", "s:axes", 11388), ("axis", "s:axes", 5598),
    ("run", "p:ran/i:running", 100), ("running", "0:run/1:i", 0),
    ("dog", "s:dogs", 900), ("dogs", "0:dog/1:s", 0),
    ("big", "r:bigger/t:biggest/f:bigness", 800),
    ("hello", "s:Hello's/p:hel lo/d:HELLOED/i:", 0), ("Hello", "s:hellos", 0),
    ("zebra", "s:zebras", 50),
]
BOOK_WORDS = ("go", "leaf", "leave", "axe", "axis", "run", "running", "dog", "dogs", "big", "hello", "Child", "ice cream")


def make_forms_ecdict(path: Path) -> Path:
    con = sqlite3.connect(path)
    con.execute("create table stardict (id integer primary key, word text, exchange text, frq integer)")
    con.executemany("insert into stardict (word, exchange, frq) values (?, ?, ?)", ECDICT_ROWS + [("ice cream", "s:ice creams", 0)])
    con.commit()
    con.close()
    return path


def write_books(folder: Path, words=BOOK_WORDS) -> Path:
    folder.mkdir(exist_ok=True)
    for book in wd.BOOK_IDS:
        rows = [{"word": w, "translations": [{"translation": "x", "type": "n"}], "phrases": [], "sentences": []}
                for w in (words if book == "junior" else ())]
        (folder / f"{book}.jsonl").write_bytes("".join(json.dumps(r) + "\n" for r in rows).encode("utf-8"))
    return folder


def table_of(tmp_path: Path) -> dict[str, str]:
    books = write_books(tmp_path / "books")
    lemmas = set(wd.collect_wanted(books)[0])
    return wd.build_forms(wd.scan_ecdict_forms(make_forms_ecdict(tmp_path / "stardict.db"), lemmas), lemmas)


@pytest.mark.parametrize("exchange, pairs", [
    ("p:went/d:gone/0:go", {"p": ["went"], "d": ["gone"], "0": ["go"]}), ("", {}), (None, {}), ("s:", {}),
    ("p:Went/p:WENT", {"p": ["went", "went"]}), ("garbage/1:p", {"1": ["p"]}), (":x", {}),
])
def test_parse_exchange_pairs(exchange, pairs):
    assert wd.parse_exchange_pairs(exchange) == pairs


def test_the_table_has_forms_from_the_lemma_row_and_from_the_form_row(tmp_path):
    table = table_of(tmp_path)
    assert table["went"] == "go" and table["gone"] == "go" and table["going"] == "go" and table["goes"] == "go"
    assert table["bigger"] == "big" and table["biggest"] == "big"  # r / t kinds; the f kind (bigness) is not an inflection
    assert "bigness" not in table and table["leafed"] == "leaf" and table["left"] == "leave"
    assert "ice creams" not in table  # a form with a space is not a single token


def test_a_form_claimed_by_several_lemmas_goes_to_the_commonest_one(tmp_path):
    table = table_of(tmp_path)
    assert table["leaves"] == "leave"  # leaf 1559 vs leave 300: the smaller rank wins
    assert table["axes"] == "axis"  # axis 5598 vs axe 11388


def test_the_tiebreak_prefers_a_known_rank_then_the_alphabet():
    scan = wd.FormsScan(candidates={"x": {"b", "a"}, "y": {"b", "a"}, "z": {"b", "a"}}, frq={"b": 5, "a": 0})
    assert wd.build_forms(scan, {"a", "b"}) == {"x": "b", "y": "b", "z": "b"}
    assert wd.build_forms(wd.FormsScan(candidates={"x": {"b", "a"}}, frq={}), {"a", "b"}) == {"x": "a"}
    assert wd.build_forms(wd.FormsScan(candidates={"x": {"b", "a"}}, frq={"a": 9, "b": 9}), {"a", "b"}) == {"x": "a"}


def test_forms_that_are_headwords_themselves_are_left_out(tmp_path):
    table = table_of(tmp_path)
    assert "running" not in table and "dogs" not in table  # both are word-book headwords: the headword lookup finds them
    assert "go" not in table and table["ran"] == "run"


def test_only_book_lemmas_count_and_bad_shaped_forms_are_dropped(tmp_path):
    table = table_of(tmp_path)
    assert "zebras" not in table  # zebra is not in the books
    assert table["hello's"] == "hello" and table["helloed"] == "hello" and table["hellos"] == "hello"
    assert "hel lo" not in table and "" not in table
    assert all(wd.FORM_RE.match(form) and form != lemma for form, lemma in table.items())


def test_the_exact_lowercase_row_supplies_the_rank(tmp_path):
    books = write_books(tmp_path / "books", ("hello", "world"))
    con = sqlite3.connect(tmp_path / "rank.db")
    con.execute("create table stardict (id integer primary key, word text, exchange text, frq integer)")
    con.executemany("insert into stardict (word, exchange, frq) values (?, ?, ?)",
                    [("Hello", "s:xa", 7), ("hello", "s:xb", 9), ("world", "s:xb", 3)])
    con.commit()
    con.close()
    lemmas = set(wd.collect_wanted(books)[0])
    scan = wd.scan_ecdict_forms(tmp_path / "rank.db", lemmas)
    assert scan.frq["hello"] == 9  # the capitalised row came first (7); the exact lower-case row wins
    assert wd.build_forms(scan, lemmas)["xb"] == "world"  # world (3) is commoner than hello (9)


def test_render_is_sorted_tab_separated_lf_and_byte_stable(tmp_path):
    table = table_of(tmp_path)
    data = wd.render_forms(table)
    lines = data.decode("utf-8").split("\n")
    assert lines[-1] == "" and b"\r" not in data
    forms = [line.split("\t")[0] for line in lines[:-1]]
    assert forms == sorted(forms) and len(set(forms)) == len(forms) and all(line.count("\t") == 1 for line in lines[:-1])
    again = tmp_path / "again"
    again.mkdir()
    assert wd.render_forms(table_of(again)) == data


def test_forms_problems_catches_schema_violations(tmp_path):
    path = tmp_path / "forms.txt"
    assert wd.forms_problems(path) == ["forms.txt: missing"]
    path.write_bytes(b"stopped\tstop\nwent\tgo\n")
    assert wd.forms_problems(path) == []
    path.write_bytes(b"stopped\tstop\nbad row\nUpper\tgo\nsame\tsame\nempty\t\ntabs\tStop\nstopped\tstop\nzed\ta\tb\naaa\tgo\n")
    assert wd.forms_problems(path) == [
        "line 2: bad row", "line 3: bad row", "line 4: bad row", "line 5: bad row", "line 6: bad row",
        "line 7: not sorted (stopped)", "line 8: bad row", "line 9: not sorted (aaa)"]


# ---- the command: file + manifest ----

def build_env(tmp_path):
    return {"zip": make_wordnet_zip(tmp_path / "wn.zip"), "db": make_ecdict(tmp_path / "stardict.db"),
            "books": make_books(tmp_path / "books"), "out": tmp_path / "out"}


def test_the_command_writes_the_file_and_adds_it_to_the_manifest(tmp_path):
    env = build_env(tmp_path)
    run_build(env)
    stats = wd.build_forms_file(None, env["out"], env["books"], ecdict_path=env["db"])
    assert stats == {"forms": 4, "lemmas_covered": 4}
    # children is a headword (left out); the fixture rows also say the -> thes, in -> ins, `Child` -> p:x, abandoned -> abandon
    assert (env["out"] / "forms.txt").read_bytes() == b"abandoned\tabandon\nins\tin\nthes\tthe\nx\tchild\n"
    manifest = json.loads((env["out"] / "SOURCE.json").read_text(encoding="utf-8"))
    entry = manifest["files"][-1]
    assert entry["file"] == "forms.txt" and entry["entries"] == 4 and entry["sha256"] == wd.sha256_of(env["out"] / "forms.txt")
    assert manifest["forms"] == {**wd.forms_rules(), "forms": 4, "lemmas_covered": 4}
    assert manifest["forms"]["version"] == wd.FORMS_VERSION and manifest["forms"]["kinds"] == list(wd.FORM_KINDS)
    assert wd.check(env["out"]) == []


def test_check_catches_a_tampered_forms_file(tmp_path):
    env = build_env(tmp_path)
    run_build(env)
    wd.build_forms_file(None, env["out"], env["books"], ecdict_path=env["db"])
    path = env["out"] / "forms.txt"
    path.write_bytes(b"x\tchild\nabandoned\tabandon\nins\tin\nthes\tthe\n")  # same size, different bytes (and unsorted)
    assert "forms.txt: sha256 mismatch" in wd.check(env["out"])
    path.write_bytes(b"x\tchild\n")
    assert any(p.startswith("forms.txt: size") for p in wd.check(env["out"]))


def test_the_command_is_byte_identical_across_runs_and_a_rebuild_keeps_it(tmp_path):
    env = build_env(tmp_path)
    run_build(env)
    wd.build_forms_file(None, env["out"], env["books"], ecdict_path=env["db"])
    first = {p.name: p.read_bytes() for p in env["out"].iterdir()}
    wd.build_forms_file(None, env["out"], env["books"], ecdict_path=env["db"])
    assert {p.name: p.read_bytes() for p in env["out"].iterdir()} == first
    run_build(env)  # `build` rewrites SOURCE.json: the forms entry and block must survive, byte for byte
    assert {p.name: p.read_bytes() for p in env["out"].iterdir()} == first
    assert wd.check(env["out"]) == []


def test_build_without_forms_does_not_invent_a_manifest_entry(tmp_path):
    env = build_env(tmp_path)
    run_build(env)
    manifest = json.loads((env["out"] / "SOURCE.json").read_text(encoding="utf-8"))
    assert "forms" not in manifest and all(f["file"] != "forms.txt" for f in manifest["files"])


def test_the_cli_command_needs_sources(tmp_path, monkeypatch):
    monkeypatch.delenv("WORDBOOK_DEFS_SOURCES", raising=False)
    with pytest.raises(SystemExit):
        wd.main(["forms", "--data-dir", str(tmp_path)])
    with pytest.raises(SystemExit):
        wd.build_forms_file(None, tmp_path, tmp_path)
