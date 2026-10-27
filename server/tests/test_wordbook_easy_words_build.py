"""易词表构建(计划 S1.1):脚本 `easy-words` 只用仓库内输入,输出排序、LF、去重、含词形与功能词,同输入逐字节相同。"""
import importlib.util
import json
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("wordbook_definitions", SERVER / "scripts" / "wordbook_definitions.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # @dataclass looks the module up by name
    spec.loader.exec_module(module)
    return module


wd = _load()


def _book(path: Path, words: list[str]) -> None:
    path.write_text("".join(json.dumps({"word": w, "translations": []}) + "\n" for w in words), encoding="utf-8")


def _fixture(tmp_path: Path) -> tuple[Path, Path]:
    books = tmp_path / "books"
    data = tmp_path / "wordbook-definitions"
    books.mkdir()
    data.mkdir()
    _book(books / "junior.jsonl", ["go", "make", "Make", "run"])
    _book(books / "senior.jsonl", ["abandon", "make"])
    _book(books / "toefl.jsonl", ["obfuscate"])  # not junior / senior: must stay out of the list
    (data / "function-words.jsonl").write_text(
        json.dumps({"word": "in", "defs": []}) + "\n" + json.dumps({"word": "a", "defs": []}) + "\n", encoding="utf-8")
    (data / "forms.txt").write_text(
        "abandoned\tabandon\nwent\tgo\nobfuscated\tobfuscate\nzebra\tzebra\n", encoding="utf-8", newline="\n")
    return books, data


def test_easy_words_are_sorted_unique_and_include_forms_and_function_words(tmp_path: Path):
    books, data = _fixture(tmp_path)
    words = wd.easy_words(books, data)
    assert words == sorted(set(words))
    assert {"go", "make", "run", "abandon", "in", "a", "abandoned", "went"} <= set(words)
    assert "obfuscate" not in words and "obfuscated" not in words  # toefl is not an easy source
    assert "zebra" not in words  # its lemma is not a junior / senior headword


def test_render_is_lf_terminated_and_byte_stable(tmp_path: Path):
    books, data = _fixture(tmp_path)
    first = wd.render_easy(wd.easy_words(books, data))
    second = wd.render_easy(wd.easy_words(books, data))
    assert first == second
    assert first.endswith(b"\n") and b"\r" not in first


def test_build_easy_file_writes_the_manifest_entry(tmp_path: Path):
    books, data = _fixture(tmp_path)
    (data / "SOURCE.json").write_text(json.dumps({"schema": 1, "files": []}), encoding="utf-8")
    stats = wd.build_easy_file(books, data)
    assert stats["words"] == len(wd.easy_words(books, data))
    manifest = json.loads((data / "SOURCE.json").read_text(encoding="utf-8"))
    entry = next(f for f in manifest["files"] if f["file"] == "easy-words.txt")
    assert entry["entries"] == stats["words"] and entry["bytes"] == (data / "easy-words.txt").stat().st_size
    assert manifest["easy_words"]["books"] == ["junior", "senior"]


def test_hard_summary_counts_not_words(tmp_path: Path):
    books, data = _fixture(tmp_path)
    (data / "SOURCE.json").write_text(json.dumps({"schema": 1, "files": []}), encoding="utf-8")
    wd.build_easy_file(books, data)
    (data / "definitions.jsonl").write_text(
        json.dumps({"word": "abate", "defs": [{"pos": "v", "text": "make less intense", "src": "oewn"}]}) + "\n",
        encoding="utf-8", newline="\n")
    hard, total = wd.hard_summary(data)
    assert (hard, total) == (1, 1)
    assert "intense" not in json.dumps({"hard": hard, "total": total})
