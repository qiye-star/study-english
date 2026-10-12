"""The offline builder scripts/wordbook_definitions.py (spec 2026-10-12-wordbook-definitions §3): fixtures only, no real sources."""
import asyncio
import importlib.util
import json
import sqlite3
import sys
import zipfile
from pathlib import Path

import httpx
import pytest
import respx

from app.core.metering import METER

SERVER = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("wordbook_definitions", SERVER / "scripts" / "wordbook_definitions.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # @dataclass looks the module up by name
    spec.loader.exec_module(module)
    return module


wd = _load()

HEADER = "  1 This software and database is being provided to you, the LICENSEE, by Princeton University\n"
LONG = "a long definition that keeps going on and on with far more than fourteen words so it must move back"

INDEX_SENSE = """abandon%2:40:01:: 02000002 2 0
abandon%2:40:00:: 02000001 1 0
abandon%1:07:00:: 05000001 1 0
stamp%1:06:02:: 05000004 3 0
stamp%1:06:00:: 05000002 1 0
stamp%1:06:01:: 05000003 2 0
child%1:18:00:: 05000005 1 0
big%3:00:00:: 01000001 1 0
quick%5:00:00:fast:01 01000002 1 0
quickly%4:02:00:: 00100001 1 0
in%1:27:00:: 05000006 1 0
in%4:02:00:: 00100002 1 0
ice_cream%1:13:00:: 05000007 1 0
go%2:38:00:: 02000003 1 0
dog%1:05:00:: 05000008 1 0
fast%3:00:00:: 01000003 1 0
sketch%1:06:00:: 05000009 1 0
grass%1:20:00:: 05000010 1 0
grass%1:18:01:: 05000011 2 0
grass%1:13:00:: 05000012 3 0
snitch%1:18:00:: 05000013 1 0
hush%1:10:00:: 05000014 1 0
hush%1:10:01:: 05000015 2 0
hush%1:10:02:: 05000016 3 0
"""
DATA = {
    "data.noun": [
        "05000001 04 n 01 abandon 0 000 | the trait of lacking restraint (see the long note on this word in the entry); \"wild abandon\"",
        "05000002 04 n 01 stamp 0 000 | a small adhesive piece of paper",
        "05000003 04 n 01 stamp 0 000 | an official mark",
        f"05000004 04 n 01 stamp 0 000 | {LONG}",
        "05000005 04 n 01 child 0 000 | a young person; \"the child cried\"; \"she has a child\"",
        "05000006 04 n 01 in 0 000 | a metallic element",
        "05000007 04 n 01 ice_cream 0 000 | a frozen dessert made from cream; \"he ate ice cream\"",
        "05000008 04 n 01 dog 0 000 | a domesticated canine",
        "05000009 04 n 01 sketch 0 000 | a quick drawing",
        "05000010 04 n 01 grass 0 000 | narrow-leaved green herbage",
        "05000011 04 n 01 grass 0 000 | (slang) a police informer who implicates many people",
        "05000012 04 n 01 grass 0 000 | the lawn of a house",
        "05000013 04 n 01 snitch 0 000 | (slang) an informer",
        "05000014 04 n 01 hush 0 000 | (British informal) a quiet spell",
        "05000015 04 n 01 hush 0 000 | informal British term for silence",
        "05000016 04 n 01 hush 0 000 | (archaic) a calm",
    ],
    "data.verb": [
        "02000001 40 v 01 abandon 0 000 | forsake, leave behind; \"abandon your children\"; \"abandon your car\"",
        "02000002 40 v 01 abandon 0 000 | give up with the intent of never claiming again",
        "02000003 38 v 01 go 0 000 | move away from a place",
    ],
    "data.adj": [
        "01000001 00 a 01 big 0 000 | above average in size (more than usual) or number; \"a big building\"",
        "01000002 00 s 01 quick 0 000 | speedy",
        "01000003 00 a 01 fast 0 000 | acting or moving quickly",
    ],
    "data.adv": ["00100001 02 r 01 quickly 0 000 | with rapid movements", "00100002 02 r 01 in 0 000 | inside a place"],
}
EXC = {"noun.exc": "children child\n", "verb.exc": "went go\nabandoned abandon\n", "adj.exc": "", "adv.exc": ""}


# ---- part of speech ----

@pytest.mark.parametrize("raw, expected", [
    ("n", ["n"]), ("n.", ["n"]), ("vt", ["v"]), ("vi", ["v"]), ("v", ["v"]), ("adj", ["a"]), ("a", ["a"]),
    ("ad", ["r"]), ("adv", ["r"]), ("a&ad", ["a", "r"]), ("n&adj", ["n", "a"]), ("ad&prep", ["r", "prep"]),
    ("vt & vi", ["v"]), ("prep", ["prep"]), ("pron", ["pron"]), ("conj", ["conj"]), ("conjunction", ["conj"]),
    ("art", ["art"]), ("indefinite article", ["art"]), ("determiner", ["art"]), ("num", ["num"]), ("aux", ["aux"]),
    ("modal verb", ["aux"]), ("int", ["int"]), ("interjection", ["int"]), ("abbr", []), ("neg", []), ("", []),
    (None, []), ("[��]n", [])])
def test_map_pos(raw, expected):
    assert wd.map_pos(raw) == expected


def test_closed_class_pos_never_read_wordnet():
    assert set(wd.CLOSED_POS) == {"prep", "pron", "conj", "art", "num", "aux", "int"} and set(wd.OPEN_POS) == {"n", "v", "a", "r"}
    assert not set(wd.CLOSED_POS) & set(wd.OPEN_POS)


# ---- gloss cleaning ----

@pytest.mark.parametrize("gloss, expected", [
    ('forsake, leave behind; "abandon your children"; "abandon your car"', "forsake, leave behind"),
    ('a young person; "the child cried"', "a young person"),
    ("above average in size (more than usual) or number", "above average in size (more than usual) or number"),
    ("the trait of lacking restraint (see the long note on this word in the entry)", "the trait of lacking restraint"),
    ('say "hello" to someone', "say to someone"),
    ("move (as in dance; slowly) forward; example", "move (as in dance; slowly) forward"),
    ("  spaced   out  ;", "spaced out"), ('"just a quote"', ""), ("", ""),
    ("broken (paren text", "broken paren text"),
    ("a thing (a very long remark with many words inside (and more)) here", "a thing here"),
])
def test_clean_gloss(gloss, expected):
    assert wd.clean_gloss(gloss) == expected


def test_pick_texts_moves_long_glosses_back_stably_and_keeps_two():
    long_a, long_b = " ".join(["w"] * 15), " ".join(["x"] * 16)
    got = wd.pick_texts([long_a, "short one", long_b, "short two", "short three"])
    assert got == ["short one", "short two"]
    assert wd.pick_texts([long_a, long_b, "short one"]) == ["short one", long_a]
    assert wd.pick_texts([long_a, long_b]) == [long_a, long_b]  # all long: sense order kept
    assert wd.pick_texts(["Same", "same", "other"]) == ["Same", "other"]  # duplicates dropped
    assert wd.pick_texts(['"only an example"', "ok"]) == ["ok"] and wd.pick_texts([]) == []


@pytest.mark.parametrize("gloss, labelled", [
    ("(slang) a police informer who implicates many people", True),
    ("(British informal) cuddle and kiss", True), ("(informal British usage) aggravation", True),
    ("(vulgar, colloquial) something", True), ("(dated slang) a remarkable thing", True),
    ("(ethnic slur) an offensive name", True), ("(Archaic) lame persons", True), ("(obsolete) a combination", True),
    ("British slang for a swindle", True), ("slang for sexual intercourse", True), ("informal British term for a cafe", True),
    ("an archaic term for a parrot", True), ("derogatory term for a variation", True), ("vulgar expression for a bout", True),
    ("offensive terms for the practices of a church", True), ("informal words for any attempt", True),
    # not labels
    ("persuaded of; very sure", False), ("a police informer who implicates many people", False),
    ("(usually informal) especially a young rabbit", False), ("(sometimes offensive) an act of swindling", False),
    ("(military) an offensive against an enemy", False), ("(of speech or dialect) pleasing in sound", False),
    ("an obsolete firearm with a long barrel", False), ("a small informal restaurant", False),
    ("rare North American crane", False), ("(Southern or Midland) considerable", False),
    ("(British) a prison", False), ("(euphemism) the removal of a threat", False), ("", False)])
def test_usage_label_detects_only_explicit_register_markers(gloss, labelled):
    assert wd.is_usage_labelled(gloss) is labelled


def test_pick_texts_drops_labelled_senses_only_when_another_sense_remains():
    assert wd.pick_texts(["a plant", "(slang) an informer", "a lawn"]) == ["a plant", "a lawn"]
    assert wd.pick_texts(["(slang) an informer", "a plant"]) == ["a plant"]
    assert wd.pick_texts(["(slang) an informer"]) == ["(slang) an informer"]  # never drop the only sense
    assert wd.pick_texts(["(slang) one", "(archaic) two", "(rare) three"]) == ["(slang) one", "(archaic) two"]  # all labelled: order kept
    assert wd.pick_texts(['(slang) "x"', "ok"]) == ["ok"]


def make_wordnet_zip(path: Path) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("oewn2025/", "")
        zf.writestr("oewn2025/index.sense", INDEX_SENSE)
        for name, lines in DATA.items():
            zf.writestr(f"oewn2025/{name}", HEADER + "\n".join(lines) + "\n")
        for name, text in EXC.items():
            zf.writestr(f"oewn2025/{name}", text)
    return path


def make_ecdict(path: Path) -> Path:
    con = sqlite3.connect(path)
    con.execute("create table stardict (id integer primary key, word text, exchange text, frq integer)")
    con.executemany("insert into stardict (word, exchange, frq) values (?, ?, ?)", [
        ("dogs", "0:dog/1:s3", 0), ("dog", "s:dogs", 900), ("the", "s:thes", 1), ("Child", "p:x", 500),
        ("child", "s:children", 400), ("in", "s:ins", 6), ("abandoned", "0:abandon/1:p", 0)])
    con.commit()
    con.close()
    return path


def book_row(word: str, *types: str) -> dict:
    return {"word": word, "us": "", "uk": "", "translations": [{"translation": "x", "type": t} for t in types],
            "phrases": [], "sentences": []}


ROWS = {
    "junior": [book_row("abandon", "vt", "n"), book_row("stamp", "n"), book_row("Child", "n"), book_row("big", "adj"),
               book_row("quick", "a"), book_row("quickly", "ad"), book_row("in", "prep", "n"), book_row("the", "art"),
               book_row("dogs", "n"), book_row("went", "v"), book_row("ice cream", "n"), book_row("a.", "n"),
               book_row("grass", "n"), book_row("snitch", "n"), book_row("hush", "n")],
    "senior": [book_row("America", "n"), book_row("TV", "n"), book_row("sweaty", "a"), book_row("fast", "a&ad"),
               book_row("sketch", "v"), book_row("mr.", "n"), book_row("hard-working", "a"), book_row("children", "n"),
               book_row("abandon", "vi"), book_row("untyped")],
}


def make_books(folder: Path) -> Path:
    folder.mkdir(exist_ok=True)
    for book in wd.BOOK_IDS:
        rows = ROWS.get(book, [])
        (folder / f"{book}.jsonl").write_bytes(
            ("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)).encode("utf-8"))
    (folder / "SOURCE.json").write_bytes(b'{"commit": "test"}\n')
    return folder


@pytest.fixture
def env(tmp_path):
    return {"zip": make_wordnet_zip(tmp_path / "wn.zip"), "db": make_ecdict(tmp_path / "stardict.db"),
            "books": make_books(tmp_path / "books"), "out": tmp_path / "out"}


def run_build(env, **kw):
    return wd.build(None, env["out"], env["books"], built="2026-10-12", wordnet_zip=env["zip"], ecdict_path=env["db"], **kw)


def rows_of(env) -> dict[str, list[tuple[str, str, str]]]:
    out = {}
    for line in (env["out"] / "definitions.jsonl").read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        out[row["word"]] = [(d["pos"], d["text"], d["src"]) for d in row["defs"]]
    return out


# ---- WordNet / ECDICT readers ----

def test_read_wordnet_orders_by_sense_number_maps_satellites_and_skips_the_licence_header(env):
    wn = wd.read_wordnet(env["zip"])
    assert wn.gloss_list("abandon", "v")[0].startswith("forsake")  # sense 1 first although listed second
    assert wn.gloss_list("quick", "a") == ["speedy"]  # ss_type 5 (satellite) is an adjective
    assert [wn.glosses[("n", off)][:10] for _, off in sorted(wn.senses[("stamp", "n")])] == [
        "a small ad", "an officia", "a long def"]
    assert wn.gloss_list("ice cream", "n")[0].startswith("a frozen")  # spaces look up as underscores
    assert wn.exceptions[("n", "children")] == ["child"] and wn.exceptions[("v", "went")] == ["go"]
    assert not any(key[1] == "x" for key in wn.glosses) and all(not g.startswith("1 This") for g in wn.glosses.values())


@pytest.mark.parametrize("exchange, lemma", [("0:go/1:p", "go"), ("p:went/d:gone", None), ("", None), (None, None),
                                             ("1:p/0:Dog", "dog")])
def test_parse_exchange(exchange, lemma):
    assert wd.parse_exchange(exchange) == lemma


def test_read_ecdict_keeps_only_wanted_words_and_prefers_the_exact_lowercase_row(env):
    info = wd.read_ecdict(env["db"], {"dogs", "child", "zzz"})
    assert info["dogs"] == wd.EcdictInfo("dog", 0) and info["child"] == wd.EcdictInfo(None, 400) and "zzz" not in info


# ---- the book scan ----

def test_collect_wanted_uses_bookindex_keys_and_pos_order(env):
    wanted, dropped = wd.collect_wanted(env["books"])
    assert dropped == 1  # "a." is a POS abbreviation (BookIndex drops it too)
    assert wanted["abandon"].pos == ["v", "n"] and wanted["fast"].pos == ["a", "r"]
    assert wanted["child"].raw == {"Child"} and wanted["untyped"].untyped and "a." not in wanted


# ---- build ----

def test_build_picks_two_per_pos_in_sense_order_and_cleans_glosses(env):
    run_build(env)
    rows = rows_of(env)
    assert rows["abandon"] == [("v", "forsake, leave behind", "oewn"),
                               ("v", "give up with the intent of never claiming again", "oewn"),
                               ("n", "the trait of lacking restraint", "oewn")]
    assert rows["stamp"] == [("n", "a small adhesive piece of paper", "oewn"), ("n", "an official mark", "oewn")]
    assert rows["big"] == [("a", "above average in size (more than usual) or number", "oewn")]
    assert rows["quick"] == [("a", "speedy", "oewn")] and rows["quickly"] == [("r", "with rapid movements", "oewn")]
    assert rows["ice cream"] == [("n", "a frozen dessert made from cream", "oewn")]


def test_build_resolves_lemmas_through_wordnet_exceptions_and_ecdict(env):
    run_build(env)
    rows = rows_of(env)
    assert rows["went"] == [("v", "move away from a place", "oewn")]       # verb.exc
    assert rows["children"] == [("n", "a young person", "oewn")]            # noun.exc
    assert rows["dogs"] == [("n", "a domesticated canine", "oewn")]         # ECDICT exchange 0:dog


def test_build_never_uses_wordnet_for_closed_class_pos(env):
    run_build(env)
    rows = rows_of(env)
    assert rows["in"] == [("n", "a metallic element", "oewn")]  # the book says n too (indium); prep stays a gap
    assert "the" not in rows
    gaps = {g.word: g for g in wd.read_missing(env["out"] / "missing.txt")}
    assert gaps["in"].pos == ("prep",) and gaps["in"].category == "function"
    assert gaps["the"].pos == ("art",) and gaps["the"].category == "function"


def test_build_drops_usage_labelled_senses_but_never_the_only_one(env):
    result = run_build(env)
    rows = rows_of(env)
    assert rows["grass"] == [("n", "narrow-leaved green herbage", "oewn"), ("n", "the lawn of a house", "oewn")]
    assert rows["snitch"] == [("n", "(slang) an informer", "oewn")]
    assert [t for _, t, _ in rows["hush"]] == ["(British informal) a quiet spell", "informal British term for silence"]
    assert result.stats["usage_filtered_pairs"] == 1


def test_build_lists_gaps_with_categories_and_counts(env):
    result = run_build(env)
    gaps = {g.word: (g.pos, g.category) for g in wd.read_missing(env["out"] / "missing.txt")}
    assert gaps["america"] == (("n",), "proper") and gaps["tv"] == (("n",), "abbr") and gaps["mr."] == (("n",), "abbr")
    assert gaps["hard-working"] == (("a",), "compound") and gaps["sweaty"] == (("a",), "other")
    assert gaps["sketch"] == (("v",), "pos_mismatch")  # WordNet has sketch only as a noun
    assert gaps["untyped"] == (("-",), "other")
    assert "fast" not in gaps  # a found, r missing: a partial open-POS gap is counted, not listed
    assert result.stats["partial_open_pos"] == 1
    assert result.stats["gap_categories"] == {"function": 2, "proper": 1, "abbr": 2, "compound": 1, "pos_mismatch": 1, "other": 2}
    assert result.stats["words_wanted"] == 23 and result.stats["gaps"] == 9


def test_missing_txt_is_sorted_by_category_then_frequency(env):
    run_build(env)
    lines = (env["out"] / "missing.txt").read_text(encoding="utf-8").splitlines()
    assert [l.split("\t")[0] for l in lines][:2] == ["the", "in"]  # function, frq 1 before frq 6
    assert lines[0] == "the\tart\tfunction\t1"


def test_output_is_sorted_lf_utf8_and_valid(env):
    run_build(env)
    raw = (env["out"] / "definitions.jsonl").read_bytes()
    assert b"\r" not in raw and not raw.startswith(b"\xef\xbb\xbf") and raw.endswith(b"\n")
    words = [json.loads(l)["word"] for l in raw.decode("utf-8").splitlines()]
    assert words == sorted(words) and len(words) == len(set(words))
    assert wd.definitions_problems(env["out"] / "definitions.jsonl") == []


def test_build_is_byte_identical_across_runs_and_dates_only_move_with_content(env):
    run_build(env)
    first = {p.name: p.read_bytes() for p in env["out"].iterdir()}
    run_build(env)
    assert {p.name: p.read_bytes() for p in env["out"].iterdir()} == first
    wd.build(None, env["out"], env["books"], wordnet_zip=env["zip"], ecdict_path=env["db"])  # no --built: kept
    assert {p.name: p.read_bytes() for p in env["out"].iterdir()} == first


def test_manifest_matches_the_files_and_check_catches_tampering(env):
    run_build(env)
    manifest = json.loads((env["out"] / "SOURCE.json").read_text(encoding="utf-8"))
    assert manifest["script_version"] == wd.SCRIPT_VERSION and manifest["built"] == "2026-10-12"
    assert [i["id"] for i in manifest["inputs"]] == ["oewn", "ecdict", "books"]
    assert manifest["inputs"][0]["license"] == "CC BY 4.0" and manifest["inputs"][1]["license"] == "MIT"
    entry = next(f for f in manifest["files"] if f["file"] == "definitions.jsonl")
    assert entry["entries"] == manifest["stats"]["words_with_defs"]
    assert wd.check(env["out"]) == []
    path = env["out"] / "definitions.jsonl"
    path.write_bytes(path.read_bytes() + b"\n")
    assert wd.check(env["out"]) == ["definitions.jsonl: size %d != %d" % (path.stat().st_size, entry["bytes"])]
    path.write_bytes(path.read_bytes()[:-1].replace(b"forsake", b"forsakE"))
    assert wd.check(env["out"]) == ["definitions.jsonl: sha256 mismatch"]
    (env["out"] / "SOURCE.json").unlink()
    assert wd.check(env["out"]) == ["SOURCE.json: missing"]


def test_definitions_problems_catches_schema_violations(tmp_path):
    bad = tmp_path / "definitions.jsonl"
    d = lambda pos, text="t", src="oewn": {"pos": pos, "text": text, "src": src}
    rows = [{"word": "b", "defs": [d("n")]}, {"word": "a", "defs": [d("n")]},            # unsorted
            {"word": "c", "defs": []}, {"word": "d", "defs": [d("zz")]}, {"word": "e", "defs": [d("n", "")]},
            {"word": "f", "defs": [d("n"), d("n"), d("n")]}, {"word": "g", "defs": [d("n", src="web")]},
            {"word": "Hello", "defs": [d("n")]}]
    bad.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    problems = wd.definitions_problems(bad)
    assert any("not sorted" in p for p in problems) and any("no defs" in p for p in problems)
    assert sum("bad def" in p for p in problems) == 3 and any("more than 2" in p for p in problems)
    assert any("bad word" in p for p in problems)


# ---- hand-written function words and the llm merge ----

def hand_file(env, rows):
    (env["out"]).mkdir(exist_ok=True)
    (env["out"] / "function-words.jsonl").write_text(
        "".join(json.dumps({"word": w, "defs": [{"pos": p, "text": t, "src": "hand"} for p, t in defs]}) + "\n"
                for w, defs in rows), encoding="utf-8")


def test_hand_entries_fill_closed_class_gaps_and_win_over_everything(env):
    hand_file(env, [("in", [("prep", "inside or within a place")]), ("stamp", [("n", "a mark made by pressing")]),
                    ("the", [("art", "used before a noun")])])
    result = run_build(env)
    rows = rows_of(env)
    assert rows["in"] == [("prep", "inside or within a place", "hand")]  # a hand entry wins entirely: no indium
    assert rows["stamp"] == [("n", "a mark made by pressing", "hand")]  # hand beats oewn
    assert rows["the"] == [("art", "used before a noun", "hand")]
    assert result.stats["pairs"]["hand"] == 3 and result.stats["gap_categories"]["function"] == 0
    assert {f["file"] for f in json.loads((env["out"] / "SOURCE.json").read_text("utf-8"))["files"]} >= {"function-words.jsonl"}


@pytest.mark.parametrize("rows, message", [
    ([("zebra", [("n", "an animal")])], "words not in any book"),
    ([("in", [("v", "go inside")])], "POS the books do not give"),
])
def test_hand_file_mistakes_stop_the_build(env, rows, message):
    hand_file(env, rows)
    with pytest.raises(SystemExit, match=message):
        run_build(env)


@pytest.mark.parametrize("text", ["x" * 5 + " " + " ".join(["w"] * 13), "has 中文", "double  space", "", "multi\nline"])
def test_hand_text_rules_are_strict(env, text):
    hand_file(env, [("the", [("art", text)])])
    with pytest.raises(wd.ExtrasError):
        run_build(env)


def test_llm_rows_fill_only_what_oewn_and_hand_left_open(env):
    (env["out"]).mkdir(exist_ok=True)
    (env["out"] / "definitions-llm.jsonl").write_text(
        json.dumps({"word": "sweaty", "defs": [{"pos": "a", "text": "wet with sweat", "src": "llm"}]}) + "\n"
        + json.dumps({"word": "stamp", "defs": [{"pos": "n", "text": "llm must not win", "src": "llm"}]}) + "\n"
        + json.dumps({"word": "the", "defs": [{"pos": "art", "text": "used before a noun", "src": "llm"}]}) + "\n"
        + json.dumps({"word": "bad", "defs": [{"pos": "n", "text": "x " * 20, "src": "llm"}]}) + "\n", encoding="utf-8")
    result = run_build(env)
    rows = rows_of(env)
    assert rows["sweaty"] == [("a", "wet with sweat", "llm")] and rows["the"] == [("art", "used before a noun", "llm")]
    assert rows["stamp"][0][2] == "oewn" and "bad" not in rows
    assert result.stats["pairs"]["llm"] == 2
    assert "sweaty" not in {g.word for g in wd.read_missing(env["out"] / "missing.txt")}  # merged gaps leave the list


# ---- inputs and the command line ----

def test_verify_reports_missing_wrong_size_and_wrong_hash(tmp_path, monkeypatch):
    sources = tmp_path / "sources"
    (sources / "ewn").mkdir(parents=True)
    zip_path = make_wordnet_zip(sources / "ewn" / "english-wordnet-2025-index.sense-fixed.zip")
    problems = wd.verify(sources)
    assert problems[0].startswith("english-wordnet-2025-index.sense-fixed.zip: size") and problems[1] == "ecdict-sqlite-28.zip: missing"
    pinned = {**wd.INPUTS["oewn"], "bytes": zip_path.stat().st_size}
    monkeypatch.setitem(wd.INPUTS, "oewn", pinned)
    assert wd.verify(sources)[0].endswith("sha256 mismatch")
    monkeypatch.setitem(wd.INPUTS, "oewn", {**pinned, "sha256": wd.sha256_of(zip_path)})
    assert wd.verify(sources) == ["ecdict-sqlite-28.zip: missing"]


# ---- llm-fill with a fake model ----

class FakeLlm:
    def __init__(self, replies=None, stop_after=None):
        self.calls, self.replies, self.stop_after = [], replies or {}, stop_after

    async def complete(self, messages):
        self.calls.append(messages)
        if self.stop_after is not None and len(self.calls) > self.stop_after:
            raise wd.LlmStopped(402, "http")
        asked = json.loads(messages[-1]["content"])
        reply = self.replies.get(len(self.calls))
        if reply is not None:
            return reply
        return json.dumps([{"word": a["word"], "defs": [{"pos": p, "text": f"meaning of {a['word']} as {p}"} for p in a["pos"]]}
                           for a in asked])


def gap(word, pos=("n",), category="other", frq=0):
    return wd.Gap(word, pos, category, frq)


def test_candidates_skip_proper_nouns_abbreviations_unknown_pos_and_done_words():
    gaps = [gap("a1"), gap("a2", category="proper"), gap("a3", category="abbr"), gap("a4", ("-",)), gap("a5"),
            gap("a6", ("prep",), "function")]
    assert [g.word for g in wd.llm_candidates(gaps, {"a5"})] == ["a1", "a6"]


def test_batches_are_forty_words():
    batches = wd.make_batches([gap(f"w{i:03d}") for i in range(85)])
    assert [len(b) for b in batches] == [40, 40, 5] and wd.LLM_BATCH == 40


def test_prompt_is_json_only_and_carries_word_and_pos_only():
    messages = wd.build_messages([gap("sweaty", ("a",)), gap("for", ("prep", "conj"), "function")])
    assert messages[0]["role"] == "system" and "at most 12 words" in messages[0]["content"] and "JSON only" in messages[0]["content"]
    assert json.loads(messages[1]["content"]) == [{"word": "sweaty", "pos": ["a"]}, {"word": "for", "pos": ["prep", "conj"]}]


def test_parse_reply_is_strict():
    batch = [gap("sweaty", ("a",)), gap("for", ("prep", "conj"), "function"), gap("eke", ("v",))]
    good = [{"word": "sweaty", "defs": [{"pos": "a", "text": "wet with sweat"}]}]
    assert wd.parse_reply(json.dumps(good), batch)["sweaty"] == [{"pos": "a", "text": "wet with sweat", "src": "llm"}]
    assert wd.parse_reply("```json\n" + json.dumps(good) + "\n```", batch).keys() == {"sweaty"}
    assert wd.parse_reply("Sure! " + json.dumps(good), batch) == {}                       # prose around the JSON
    assert wd.parse_reply('{"word": "sweaty"}', batch) == {} and wd.parse_reply("", batch) == {}
    reject = [
        {"word": "other", "defs": [{"pos": "a", "text": "x"}]},                              # not asked
        {"word": "for", "defs": [{"pos": "prep", "text": "x"}]},                              # a POS missing
        {"word": "for", "defs": [{"pos": "prep", "text": "x"}, {"pos": "prep", "text": "y"}]},  # a POS twice
        {"word": "for", "defs": [{"pos": "prep", "text": "x"}, {"pos": "n", "text": "y"}]},     # a POS not asked
        {"word": "eke", "defs": [{"pos": "v", "text": " ".join(["w"] * 13)}]},                 # 13 words
        {"word": "eke", "defs": [{"pos": "v", "text": "中文"}]},
        {"word": "eke", "defs": [{"pos": "v"}]}, {"word": "eke", "defs": "x"}, "junk", None]
    assert wd.parse_reply(json.dumps(reject), batch) == {}
    both = wd.parse_reply(json.dumps([{"word": "for", "defs": [{"pos": "conj", "text": "because"}, {"pos": "prep", "text": "to help"}]}]), batch)
    assert [d["pos"] for d in both["for"]] == ["prep", "conj"]  # asked order


def test_run_fill_writes_sorted_rows_and_reports(tmp_path):
    out = tmp_path / "definitions-llm.jsonl"
    gaps = [gap(f"w{i:03d}") for i in range(85)]
    llm = FakeLlm()
    report = asyncio.run(wd.run_fill(llm, gaps, out))
    assert report == {"candidates": 85, "batches": 3, "filled": 85, "rejected_words": 0, "bad_batches": 0}
    rows = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines()]
    assert [r["word"] for r in rows] == sorted(r["word"] for r in rows) and len(rows) == 85
    assert all(d["src"] == "llm" for r in rows for d in r["defs"])
    assert b"\r" not in out.read_bytes()


def test_run_fill_resumes_after_a_402_and_never_repeats_a_word(tmp_path):
    out = tmp_path / "definitions-llm.jsonl"
    gaps = [gap(f"w{i:03d}") for i in range(85)]
    first = FakeLlm(stop_after=1)  # the second call answers 402
    with pytest.raises(wd.LlmStopped) as caught:
        asyncio.run(wd.run_fill(first, gaps, out))
    assert caught.value.status == 402 and len(first.calls) == 2
    assert len(out.read_text(encoding="utf-8").splitlines()) == 40  # progress kept
    second = FakeLlm()
    report = asyncio.run(wd.run_fill(second, gaps, out))
    assert report["candidates"] == 45 and report["filled"] == 45 and len(second.calls) == 2
    asked = {a["word"] for call in first.calls[:1] + second.calls for a in json.loads(call[-1]["content"])}
    assert len(asked) == 85 and len(out.read_text(encoding="utf-8").splitlines()) == 85


def test_run_fill_counts_bad_replies_and_keeps_those_words_queued(tmp_path):
    out = tmp_path / "definitions-llm.jsonl"
    gaps = [gap("aaa"), gap("bbb")]
    report = asyncio.run(wd.run_fill(FakeLlm({1: "not json"}), gaps, out))
    assert report["bad_batches"] == 1 and report["filled"] == 0 and not out.exists() or out.read_text(encoding="utf-8") == ""
    report = asyncio.run(wd.run_fill(FakeLlm(), gaps, out))
    assert report["filled"] == 2


def test_run_fill_max_batches(tmp_path):
    out = tmp_path / "definitions-llm.jsonl"
    llm = FakeLlm()
    report = asyncio.run(wd.run_fill(llm, [gap(f"w{i:03d}") for i in range(85)], out, max_batches=1))
    assert report["batches"] == 1 and len(llm.calls) == 1 and len(out.read_text(encoding="utf-8").splitlines()) == 40


def test_spot_check_is_a_stable_five_percent_sample(tmp_path):
    out = tmp_path / "definitions-llm.jsonl"
    asyncio.run(wd.run_fill(FakeLlm(), [gap(f"w{i:03d}") for i in range(100)], out))
    sample = wd.spot_check(out)
    assert len(sample) == 5 and sample == wd.spot_check(out) and sample == sorted(sample)
    assert wd.spot_check(tmp_path / "none.jsonl") == []


def test_fill_then_build_merges_the_filled_words(env):
    run_build(env)
    gaps = wd.read_missing(env["out"] / "missing.txt")
    asyncio.run(wd.run_fill(FakeLlm(), gaps, env["out"] / "definitions-llm.jsonl"))
    result = run_build(env)
    rows = rows_of(env)
    assert rows["sweaty"] == [("a", "meaning of sweaty as a", "llm")] and rows["the"][0][2] == "llm"
    assert "america" not in rows and "tv" not in rows  # proper nouns / abbreviations are never sent
    assert result.stats["gap_categories"]["function"] == 0 and result.stats["gap_categories"]["other"] == 1  # only the word with no POS
    assert wd.check(env["out"]) == []


# ---- the real client (only the mapping; nothing is ever sent for real) ----

async def test_real_client_maps_an_upstream_refusal_to_a_clean_stop(monkeypatch):
    """No http, no .env: `Settings` and `llm.complete` are replaced, so nothing is ever sent."""
    from app.providers import llm
    import app.core.config as config

    class StubSettings:
        default_llm_model = "stub-model"

    seen = {}

    async def refuse(http, settings, messages, **kw):
        seen["model"] = kw["model"]
        raise llm.LlmUnavailable("http", 402)

    monkeypatch.setattr(config, "Settings", StubSettings)
    monkeypatch.setattr(llm, "complete", refuse)
    client = wd.RealLlm()
    try:
        with pytest.raises(wd.LlmStopped) as caught:
            await client.complete([{"role": "user", "content": "[]"}])
        assert caught.value.status == 402 and caught.value.kind == "http" and seen["model"] == "stub-model"

        async def answer(http, settings, messages, **kw):
            return "[]"

        monkeypatch.setattr(llm, "complete", answer)
        assert await client.complete([{"role": "user", "content": "[]"}]) == "[]"
    finally:
        await client.aclose()


def test_cli_check_and_missing_sources_message(env, capsys, monkeypatch):
    run_build(env)
    assert wd.main(["check", "--data-dir", str(env["out"])]) == 0 and capsys.readouterr().out.strip() == "ok"
    monkeypatch.delenv("WORDBOOK_DEFS_SOURCES", raising=False)
    with pytest.raises(SystemExit, match="WORDBOOK_DEFS_SOURCES"):
        wd.main(["verify"])
    monkeypatch.setenv("WORDBOOK_DEFS_SOURCES", str(env["out"]))
    assert wd.main(["verify"]) == 1 and "missing" in capsys.readouterr().out


def test_the_script_is_not_imported_by_the_app():
    for path in (SERVER / "app").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "import wordbook_definitions" not in text and "scripts.wordbook_definitions" not in text, path


def test_cli_llm_fill_runs_through_a_fake_client_and_exits_3_when_the_upstream_stops(env, capsys, monkeypatch, tmp_path):
    run_build(env)

    class Wrapped(FakeLlm):
        async def aclose(self):
            pass

    monkeypatch.setattr(wd, "RealLlm", lambda: Wrapped())
    report = tmp_path / "spot.txt"
    args = ["llm-fill", "--data-dir", str(env["out"]), "--report", str(report)]
    assert wd.main(args) == 0 and (env["out"] / "definitions-llm.jsonl").is_file() and report.is_file()
    assert "spot-check" in capsys.readouterr().out
    (env["out"] / "definitions-llm.jsonl").unlink()
    monkeypatch.setattr(wd, "RealLlm", lambda: Wrapped(stop_after=0))
    assert wd.main(args) == 3 and "stopped" in capsys.readouterr().out


def test_cli_llm_fill_needs_a_built_missing_list(tmp_path):
    with pytest.raises(SystemExit, match="build"):
        wd.main(["llm-fill", "--data-dir", str(tmp_path)])
