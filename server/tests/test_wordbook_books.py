import json
from pathlib import Path

from app.wordbook.books import BOOK_IDS, BOOKS, book_by_id, default_data_dir, enabled_books
from tests.wordbook_helpers import MINI, make_data_dir

MANIFEST = Path(__file__).resolve().parents[1] / "dictionaries" / "kylebing-english-vocabulary" / "SOURCE.json"


def test_catalogue_matches_manifest():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert BOOK_IDS == tuple(b["id"] for b in manifest["books"])
    for spec, row in zip(BOOKS, manifest["books"]):
        assert (spec.file, spec.entries, spec.unique) == (row["file"], row["entries"], row["unique"])
    assert [b.level for b in BOOKS] == [1, 2, 3, 4, 4, 5, 6]
    assert book_by_id("cet4").title_zh == "四级" and book_by_id("nope") is None


def test_enabled_books_keeps_catalogue_order_and_drops_unknown():
    assert enabled_books("sat, junior ,bogus,,junior") == ("junior", "sat")
    assert enabled_books("") == ()


def test_default_data_dir_is_next_to_the_app_package():
    path = default_data_dir()
    assert path.name == "kylebing-english-vocabulary" and path.parent.name == "dictionaries"
    assert (path / "SOURCE.json").is_file()


def test_mini_fixture_is_lf_json_lines(tmp_path):
    raw = MINI.read_bytes()
    assert b"\r\n" not in raw and raw.endswith(b"\n")
    lines = raw.decode("utf-8").splitlines()
    assert len(lines) == 17 and all(json.loads(line)["word"] for line in lines)
    data = make_data_dir(tmp_path, ("junior", "sat"))
    assert sorted(p.name for p in data.iterdir()) == ["junior.jsonl", "sat.jsonl"]
