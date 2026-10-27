"""简单英英释义的读路径(计划 2026-10-27 S4 / R-S4):同步、零上游、不记录日志。

开关关 = 与改动前逐字节相同;开关开 = 有 ok 行就换简化文本;skip / failed / 无行 = 原文(无行且判为难 = 入队)。"""
import ast
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from app.wordbook.index import DictionaryStore
from app.wordbook.simple_defs import SimpleDefs, SimpleRow, src_hash

SERVER = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)
EASY = frozenset({"make", "less", "a", "state", "or", "the", "to", "of", "become"})
ORIGINAL_V = "make less intense"  # "intense" is hard
ORIGINAL_N = "a state of mind"  # "mind" is hard


def _settings(enabled=True, generate=True, upstream=True):
    s = SimpleNamespace(wordbook_simple_defs_enabled=enabled, wordbook_simple_defs_generate=generate,
                        upstream_llm_base_url="https://llm.example" if upstream else "")
    s.wordbook_simple_defs_generate_available = enabled and generate and upstream
    return s


def _defs(tmp: Path, *rows: dict) -> Path:
    data = tmp / "kylebing-english-vocabulary"
    data.mkdir(parents=True, exist_ok=True)
    defs_dir = tmp / "wordbook-definitions"
    defs_dir.mkdir(parents=True, exist_ok=True)
    (defs_dir / "definitions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return data


def _store(tmp: Path, settings, rows: dict, *, max_queue: int = 2000) -> tuple[DictionaryStore, SimpleDefs]:
    data = _defs(tmp, {"word": "abate", "defs": [{"pos": "v", "text": ORIGINAL_V, "src": "oewn"},
                                                  {"pos": "n", "text": ORIGINAL_N, "src": "oewn"}]})
    store = DictionaryStore(data)
    simple = SimpleDefs(data, lambda: settings, max_queue=max_queue)
    simple.install(easy=EASY, lemmas={}, rows=rows)
    store.simple = simple
    return store, simple


def _ok(word: str, pos: str, original: str, text: str) -> tuple:
    return (word, pos, src_hash(original)), SimpleRow("ok", text, 0, None)


def test_switch_off_is_byte_identical_to_the_definitions_file(tmp_path: Path):
    settings = _settings(enabled=False)
    store, simple = _store(tmp_path, settings, dict([_ok("abate", "v", ORIGINAL_V, "make less")]))
    assert store.english_defs("abate") == store.definitions.defs_for("abate")
    assert simple.queue == {}


def test_a_cached_ok_row_replaces_only_its_own_part_of_speech(tmp_path: Path):
    store, _ = _store(tmp_path, _settings(), dict([_ok("abate", "v", ORIGINAL_V, "make less")]))
    assert store.english_defs("abate") == [{"pos": "v", "text": "make less"},
                                           {"pos": "n", "text": ORIGINAL_N}]


def test_skip_and_exhausted_failed_rows_keep_the_original(tmp_path: Path):
    rows = {
        ("abate", "v", src_hash(ORIGINAL_V)): SimpleRow("skip", None, 0, None),
        ("abate", "n", src_hash(ORIGINAL_N)): SimpleRow("failed", None, 3, NOW - timedelta(days=1)),
    }
    store, simple = _store(tmp_path, _settings(), rows)
    assert store.english_defs("abate") == store.definitions.defs_for("abate")
    assert simple.queue == {}


def test_a_failed_row_that_is_due_is_queued_and_still_shows_the_original(tmp_path: Path):
    rows = {("abate", "v", src_hash(ORIGINAL_V)): SimpleRow("failed", None, 1, datetime.now(timezone.utc) - timedelta(minutes=1))}
    store, simple = _store(tmp_path, _settings(), rows)
    assert store.english_defs("abate")[0]["text"] == ORIGINAL_V
    assert ("abate", "v", src_hash(ORIGINAL_V)) in simple.queue


def test_a_failed_row_before_its_retry_time_is_not_queued(tmp_path: Path):
    rows = {("abate", "v", src_hash(ORIGINAL_V)): SimpleRow("failed", None, 1, NOW + timedelta(hours=1))}
    store, simple = _store(tmp_path, _settings(), rows)
    simple.apply("abate", [{"pos": "v", "text": ORIGINAL_V}], NOW)
    assert simple.queue == {}


def test_a_hard_definition_without_a_row_is_queued_once_and_shows_the_original(tmp_path: Path):
    store, simple = _store(tmp_path, _settings(), {})
    assert store.english_defs("abate")[0]["text"] == ORIGINAL_V
    store.english_defs("abate")
    assert list(simple.queue) == [("abate", "v", src_hash(ORIGINAL_V)), ("abate", "n", src_hash(ORIGINAL_N))]


def test_an_easy_definition_without_a_row_is_not_queued(tmp_path: Path):
    simple = SimpleDefs(tmp_path, lambda: _settings())
    simple.install(easy=EASY, lemmas={}, rows={})
    out = simple.apply("abate", [{"pos": "v", "text": "make less"}], NOW)
    assert out == [{"pos": "v", "text": "make less"}] and simple.queue == {}


def test_a_changed_source_text_does_not_use_the_old_row(tmp_path: Path):
    old = ("abate", "v", src_hash("make less intense now"))  # the file's text changed: this hash no longer matches
    store, simple = _store(tmp_path, _settings(), {old: SimpleRow("ok", "make less", 0, None)})
    assert store.english_defs("abate")[0]["text"] == ORIGINAL_V
    assert ("abate", "v", src_hash(ORIGINAL_V)) in simple.queue


def test_generation_off_reads_the_cache_but_queues_nothing(tmp_path: Path):
    store, simple = _store(tmp_path, _settings(generate=False), {})
    assert store.english_defs("abate")[0]["text"] == ORIGINAL_V
    assert simple.queue == {}


def test_not_loaded_yet_returns_the_original_and_queues_nothing(tmp_path: Path):
    settings = _settings()
    simple = SimpleDefs(tmp_path, lambda: settings)
    out = simple.apply("abate", [{"pos": "v", "text": ORIGINAL_V}], NOW)
    assert out == [{"pos": "v", "text": ORIGINAL_V}] and simple.queue == {}


def test_a_full_queue_drops_silently(tmp_path: Path):
    simple = SimpleDefs(tmp_path, lambda: _settings(), max_queue=1)
    simple.install(easy=EASY, lemmas={}, rows={})
    simple.apply("abate", [{"pos": "v", "text": ORIGINAL_V}, {"pos": "n", "text": ORIGINAL_N}], NOW)
    assert len(simple.queue) == 1


def test_the_read_module_has_no_logging(tmp_path: Path):
    tree = ast.parse((SERVER / "app" / "wordbook" / "simple_defs.py").read_text(encoding="utf-8"))
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    imported = {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    assert "logger" not in names and "logging" not in imported


def test_card_and_lookup_paths_use_the_cached_english_definitions():
    for rel in ("app/wordbook/service.py", "app/wordbook/lookup.py"):
        source = (SERVER / rel).read_text(encoding="utf-8")
        assert "english_defs(" in source, rel
        assert "definitions.defs_for(" not in source, rel
