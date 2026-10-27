"""第一层来源(计划 2026-10-27 R-S1 与用户裁定):可插拔接口;没有数据文件 = 空来源;来源答得好就不调用模型。"""
import json
from pathlib import Path

from app.providers import llm
from app.wordbook import simple_defs_worker as worker
from app.wordbook.simple_defs import simple_of, src_hash
from app.wordbook.simple_sources import FileSource, default_sources

EASY = frozenset({"make", "less", "strong", "a", "state", "of", "feeling", "or", "the", "to"})
ABATE_V = "make less intense"  # hard: intense


class Source:
    name = "fake"

    def __init__(self, answers: dict):
        self.answers = answers

    def prepare(self) -> None:
        return None

    def simple_text(self, word: str, pos: str):
        return self.answers.get((word, pos))


def _configure(app):
    app.state.settings = app.state.settings.model_copy(update={
        "wordbook_simple_defs_enabled": True, "wordbook_simple_defs_generate": True,
        "upstream_llm_base_url": "https://llm.example"})
    simple = simple_of(app)
    simple.install(easy=EASY, lemmas={}, rows={})
    return simple


async def test_a_source_answer_is_cached_without_a_model_call(app, monkeypatch):
    calls = []

    async def no_model(*args, **kwargs):
        calls.append(1)
        return "{}"

    monkeypatch.setattr(llm, "complete", no_model)
    simple = _configure(app)
    simple.sources = (Source({("abate", "v"): "make less strong"}),)
    simple.queue[("abate", "v", src_hash(ABATE_V))] = ("abate", "v", ABATE_V)
    assert await worker.run_once(app) == 1
    assert calls == []
    assert simple.rows[("abate", "v", src_hash(ABATE_V))].text == "make less strong"
    assert simple.rows[("abate", "v", src_hash(ABATE_V))].status == "ok"
    async with app.state.sessionmaker() as session:
        from sqlalchemy import select

        from app.models import WordbookSimpleDef
        row = await session.scalar(select(WordbookSimpleDef).where(WordbookSimpleDef.word == "abate"))
        assert row.model == "source:fake" and row.prompt_version is None


async def test_a_source_text_that_fails_the_check_goes_to_the_model(app, monkeypatch):
    seen = []

    async def model(http, settings, messages, *, model, max_tokens, temperature, timeout=60.0):
        seen.append(1)
        return json.dumps({"items": [{"id": 0, "text": "make less strong"}]})

    monkeypatch.setattr(llm, "complete", model)
    simple = _configure(app)
    simple.sources = (Source({("abate", "v"): "make less intense"}),)  # no fewer hard words: rejected
    simple.queue[("abate", "v", src_hash(ABATE_V))] = ("abate", "v", ABATE_V)
    assert await worker.run_once(app) == 1
    assert seen == [1]
    assert simple.rows[("abate", "v", src_hash(ABATE_V))].text == "make less strong"


def test_the_file_source_reads_its_lines_and_skips_bad_ones(tmp_path: Path):
    path = tmp_path / "simple-wiktionary.jsonl"
    path.write_text("\n".join([
        json.dumps({"word": "Abate", "pos": "v", "text": "make  less"}),
        "not json",
        json.dumps({"word": "x", "pos": "n"}),
        json.dumps({"word": "y", "pos": "n", "text": "   "}),
    ]) + "\n", encoding="utf-8")
    source = FileSource("simple-wiktionary", path)
    assert source.simple_text("abate", "v") == "make less"
    assert source.simple_text("x", "n") is None and source.simple_text("y", "n") is None


def test_a_missing_file_is_an_empty_source(tmp_path: Path):
    source = FileSource("simple-wiktionary", tmp_path / "absent.jsonl")
    assert source.simple_text("abate", "v") is None


def test_the_default_first_layer_sits_beside_the_word_book_folder(tmp_path: Path):
    (sources,) = [default_sources(tmp_path / "kylebing-english-vocabulary")]
    assert sources[0].name == "simple-wiktionary"
    assert sources[0].path == tmp_path / "wordbook-definitions" / "simple-wiktionary.jsonl"
