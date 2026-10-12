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
