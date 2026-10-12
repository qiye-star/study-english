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


# ---- every endpoint that builds a card ----

async def login(app, client, tmp_path, *, defs=True, books=("junior",)):
    enable_wordbook(app, make_data_dir(tmp_path, books), wordbook_books=",".join(books))
    if defs:
        make_defs_dir(tmp_path)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": books[0], "order_mode": "book"})
    return h


async def test_learn_batch_cards_carry_defs_en_and_keep_every_old_key(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    cards = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 3})).json()["cards"]
    assert cards and all({"key", "word", "us", "uk", "senses", "phrases", "examples"} <= set(c) for c in cards)
    talk = next(c for c in cards if c["key"] == "talk")
    assert talk["defs_en"] == [{"pos": "v", "text": "speak to someone"}, {"pos": "v", "text": "have a conversation"},
                               {"pos": "n", "text": "a conversation between people"}]


async def test_no_definitions_file_means_no_defs_en_key(app, client, tmp_path):
    h = await login(app, client, tmp_path, defs=False)
    cards = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 3})).json()["cards"]
    assert cards and all("defs_en" not in c for c in cards)
    assert "defs_en" not in (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()


async def test_a_word_without_a_definition_has_no_key(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    make_defs_dir(tmp_path, {"ability": [("n", "skill")]})
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await client.get(f"{URL}/cards/junior/ability", headers=h)).json()["defs_en"] == [{"pos": "n", "text": "skill"}]
    assert "defs_en" not in (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()


async def test_card_detail_review_learned_card_and_free_start_carry_it(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()["defs_en"][0]["text"] == "speak to someone"
    await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": "talk", "mode": "learn",
                                                         "qtype": "meaning", "known": True})
    learned = await client.post(f"{URL}/learned/card", headers=h, json={"book_id": "junior", "key": "talk"})
    assert learned.json()["defs_en"][0]["pos"] == "v"
    free = await client.post(f"{URL}/free/start", headers=h, json={"scope": "all", "mode": "browse", "count": 10})
    assert [i["card"]["defs_en"][0]["pos"] for i in free.json()["items"]] == ["v"]


async def test_more_than_four_defs_in_the_file_are_cut_at_four(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    make_defs_dir(tmp_path, {"talk": [("n", "n1"), ("n", "n2"), ("v", "v1"), ("v", "v2"), ("a", "a1"), ("r", "r1")]})
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    got = (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()["defs_en"]
    assert [(d["pos"], d["text"]) for d in got] == [("n", "n1"), ("v", "v1"), ("a", "a1"), ("r", "r1")]


async def test_links_word_card_carries_it_too(app, client, tmp_path):
    from tests.links_helpers import enable_links
    h = await login(app, client, tmp_path)
    enable_links(app)
    r = await client.post("/api/links/wordbook/card", headers=h, json={"word": "talk"})
    assert r.status_code == 200 and r.json()["card"]["defs_en"][0]["text"] == "speak to someone"


async def test_reading_definitions_logs_no_words_and_calls_nothing_out(app, client, tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    h = await login(app, client, tmp_path)
    await client.post(f"{URL}/learn/batch", headers=h, json={"size": 3})
    await client.get(f"{URL}/cards/junior/talk", headers=h)
    assert "speak to someone" not in caplog.text and "talk" not in caplog.text
