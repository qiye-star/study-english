"""English definitions at runtime (spec 2026-10-12-wordbook-definitions §3-§4): loader, selection, `defs_en` on every card."""
import asyncio
import logging
import threading
from pathlib import Path

import pytest

from app.wordbook.definitions import FILE_NAME, Definitions, default_path, select_defs
from tests.wordbook_helpers import enable_wordbook, make_data_dir, make_defs_dir

URL = "/api/wordbook"


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))
    return path


# ---- select_defs: <= 2 per POS, <= 4 in total, first of every POS before any second ----

def test_select_keeps_everything_under_the_limits():
    defs = [("n", "a"), ("n", "b"), ("v", "c")]
    assert select_defs(defs) == defs


def test_select_caps_two_per_pos():
    defs = [("n", "a"), ("n", "b"), ("n", "c")]
    assert select_defs(defs) == [("n", "a"), ("n", "b")]


def test_select_caps_four_in_total_and_gives_each_pos_its_first_entry_first():
    defs = [("n", "n1"), ("n", "n2"), ("v", "v1"), ("v", "v2"), ("a", "a1"), ("a", "a2"), ("r", "r1")]
    # firsts n1 v1 a1 r1 fill all four places; no second entry gets in, order stays the file order
    assert select_defs(defs) == [("n", "n1"), ("v", "v1"), ("a", "a1"), ("r", "r1")]


def test_select_uses_left_over_places_for_second_entries_in_file_order():
    defs = [("n", "n1"), ("n", "n2"), ("v", "v1"), ("v", "v2"), ("a", "a1")]
    assert select_defs(defs) == [("n", "n1"), ("n", "n2"), ("v", "v1"), ("a", "a1")]


# ---- Definitions loader ----

def test_default_path_is_a_sibling_of_the_book_directory(tmp_path):
    assert default_path(tmp_path / "dictionaries" / "kylebing-english-vocabulary") == (
        tmp_path / "dictionaries" / "wordbook-definitions" / FILE_NAME)


def test_loader_reads_lowercase_keys_and_returns_wire_shape(tmp_path):
    path = write(tmp_path / FILE_NAME,
                 '{"word":"talk","defs":[{"pos":"v","text":"speak","src":"oewn"},{"pos":"n","text":"a chat","src":"oewn"}]}\n')
    d = Definitions(path)
    assert d.defs_for("talk") == [{"pos": "v", "text": "speak"}, {"pos": "n", "text": "a chat"}]
    assert d.defs_for("Talk") == [] and d.defs_for("zebra") == []
    assert len(d) == 1


def test_missing_file_means_no_definitions_and_no_error(tmp_path):
    d = Definitions(tmp_path / "nope" / FILE_NAME)
    assert d.defs_for("talk") == [] and len(d) == 0


def test_bad_lines_are_skipped_not_fatal(tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="app")
    good = '{"word":"talk","defs":[{"pos":"v","text":"speak","src":"oewn"}]}'
    path = write(tmp_path / FILE_NAME, "\n".join([
        "not json", '{"word":"x"}', '{"word":"y","defs":[]}', '{"word":"z","defs":[{"pos":"zz","text":"t"}]}',
        '{"word":"w","defs":[{"pos":"n","text":"  "}]}', good]) + "\n")
    d = Definitions(path)
    assert d.defs_for("talk") == [{"pos": "v", "text": "speak"}]
    assert all(d.defs_for(w) == [] for w in "xyzw")
    assert "skipped lines=5" in caplog.text
    assert "talk" not in caplog.text  # words never reach the log


def test_reload_picks_up_a_changed_file(tmp_path):
    path = write(tmp_path / FILE_NAME, '{"word":"a1","defs":[{"pos":"n","text":"one"}]}\n')
    d = Definitions(path)
    assert d.defs_for("a1")
    write(path, '{"word":"b1","defs":[{"pos":"n","text":"two"}]}\n')
    assert d.defs_for("b1") == []  # cached until reload
    d.reload()
    assert d.defs_for("b1") and not d.defs_for("a1")


def test_concurrent_first_use_loads_once(tmp_path):
    path = write(tmp_path / FILE_NAME, '{"word":"talk","defs":[{"pos":"v","text":"speak"}]}\n')
    d = Definitions(path)
    loads = []
    real = d._load

    def counting():
        loads.append(1)
        return real()

    d._load = counting
    threads = [threading.Thread(target=lambda: d.defs_for("talk")) for _ in range(8)]
    [t.start() for t in threads]
    [t.join(5) for t in threads]
    assert len(loads) == 1


async def test_warm_loads_off_the_loop_once(tmp_path):
    path = write(tmp_path / FILE_NAME, '{"word":"talk","defs":[{"pos":"v","text":"speak"}]}\n')
    d = Definitions(path)
    await asyncio.gather(d.warm(), d.warm())
    assert d._data is not None and d.defs_for("talk")


def test_the_loader_module_is_stdlib_only():
    source = (Path(__file__).resolve().parents[1] / "app" / "wordbook" / "definitions.py").read_text(encoding="utf-8")
    imports = {line.split()[1].split(".")[0] for line in source.splitlines() if line.startswith(("import ", "from "))}
    assert imports <= {"asyncio", "json", "logging", "threading", "pathlib"}  # no httpx, no app.providers: nothing can call out
