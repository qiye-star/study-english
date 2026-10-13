"""The local dictionary behind select-to-lookup (spec 2026-10-13-defs-default-lookup-ios §3.2): query normalisation,
direct hits, inflection, phrases, misses, degraded data, hot file changes. Module-level tests; the endpoint is in
test_dictionary_api.py."""
import asyncio
import json
import logging
from pathlib import Path

import pytest

from app.wordbook import lookup as lk
from app.wordbook.forms import FILE_NAME, Forms, default_path
from app.wordbook.index import DictionaryStore
from tests.wordbook_helpers import make_data_dir, make_defs_dir

FORMS = "children\tchild\nstopped\tstop\ntalk\tgo\ntalks\ttalk\nwent\tgo\n"


def build(tmp_path: Path, forms: str | None = FORMS, defs: bool = True) -> lk.DictionaryLookup:
    """`<tmp>/dict/junior.jsonl` (the mini book), `<tmp>/wordbook-definitions/{definitions,forms}`: what the loader finds."""
    data = make_data_dir(tmp_path)
    folder = make_defs_dir(tmp_path) if defs else tmp_path / "wordbook-definitions"
    folder.mkdir(exist_ok=True)
    if forms is not None:
        (folder / FILE_NAME).write_bytes(forms.encode("utf-8"))
    return lk.DictionaryLookup(DictionaryStore(data))


# ---- normalisation ----

@pytest.mark.parametrize("raw, key", [
    ("talk", "talk"), ("  Talk!  ", "talk"), ("“talk”", "talk"), ("(TALK),", "talk"), ("don’t", "don't"),
    ("  be   able  to ", "be able to"), ("Talk about it?", "talk about it"), ("-well-", "well"), ("a-b c", "a-b c"),
])
def test_normalize_query_lowercases_folds_and_strips_edge_punctuation(raw, key):
    assert lk.normalize_query(raw) == key


@pytest.mark.parametrize("raw", [
    "", "   ", "...", "“”", "a b c d", "x" * 41, "谈话", "talk 说", "undersize d", "one two three four five",
])
def test_normalize_query_rejects_non_candidates(raw):
    assert lk.normalize_query(raw) is None


def test_the_limits_are_three_words_and_forty_characters():
    assert lk.normalize_query("a b c") == "a b c" and lk.normalize_query("a b c d") is None
    assert lk.normalize_query("x" * 40) == "x" * 40 and lk.normalize_query("x" * 41) is None


# ---- direct hits ----

async def test_direct_hit_returns_the_card_in_wire_shape(tmp_path):
    out = await build(tmp_path).lookup("talk")
    assert list(out) == ["hit", "word", "phonetic", "defs_zh", "defs_en", "phrases", "source"]
    assert out["hit"] is True and out["word"] == "talk" and out["source"] == "dict" and "lemma" not in out
    assert out["phonetic"] == "tɔk"
    assert out["defs_zh"][0] == {"pos": "v", "text": "说话；谈话"}
    assert out["defs_en"] == [{"pos": "v", "text": "speak to someone"}, {"pos": "v", "text": "have a conversation"},
                              {"pos": "n", "text": "a conversation between people"}]
    assert out["phrases"] == [{"en": "talk about", "zh": "谈论某事"}]


async def test_the_display_form_comes_from_the_book(tmp_path):
    out = await build(tmp_path).lookup("monday")
    assert out["word"] == "Monday" and "lemma" not in out
    assert out["defs_en"] == [{"pos": "n", "text": "the day of the week after Sunday"}]
    assert "phrases" not in out


async def test_case_and_edge_punctuation_do_not_matter(tmp_path):
    lookup = build(tmp_path)
    assert await lookup.lookup("  TALK. ") == await lookup.lookup("talk")


async def test_a_phonetic_is_left_out_when_the_book_has_none(tmp_path):
    out = await build(tmp_path).lookup("used to")
    assert out["word"] == "used to" and "phonetic" not in out
    assert out["defs_zh"] == [{"pos": "v", "text": "过去常常"}]
    assert out["defs_en"] == [{"pos": "v", "text": "did something often in the past"}]


async def test_at_most_three_phrases_and_four_chinese_senses(tmp_path):
    lookup = build(tmp_path)
    card = await lookup._card("talk")
    many = type(card)(card.key, card.word, card.us, card.uk, card.senses * 4,
                      tuple((f"p{i}", f"z{i}") for i in range(8)), card.examples, card.pos_mask)
    out = lookup._entry("talk", many)
    assert len(out["defs_zh"]) == lk.MAX_ZH == 4 and len(out["phrases"]) == lk.MAX_PHRASES == 3


async def test_an_entry_without_any_definition_is_a_miss(tmp_path):
    lookup = build(tmp_path)
    card = await lookup._card("talk")
    bare = type(card)(card.key, card.word, card.us, card.uk, (), (), (), 0)
    lookup.store.definitions._data = {}  # no English definitions either
    assert lookup._entry("talk", bare) is None


# ---- inflection ----

async def test_an_inflected_form_finds_its_lemma(tmp_path):
    lookup = build(tmp_path)
    went = await lookup.lookup("Went")
    assert went["word"] == "went" and went["lemma"] == "go" and went["defs_zh"][0]["text"] == "去；走"
    assert went["defs_en"] == [{"pos": "v", "text": "move or travel to a place"}] and went["source"] == "dict"
    assert (await lookup.lookup("children"))["lemma"] == "child"
    assert (await lookup.lookup("stopped"))["lemma"] == "stop"


async def test_a_headword_beats_the_form_table(tmp_path):
    out = await build(tmp_path).lookup("talk")  # the table says talk -> go, the book has talk
    assert out["word"] == "talk" and "lemma" not in out


async def test_a_possessive_falls_back_to_the_bare_word(tmp_path):
    out = await build(tmp_path).lookup("Talk’s")
    assert out["word"] == "talk's" and out["lemma"] == "talk"


async def test_a_form_whose_lemma_is_not_in_the_books_is_a_miss(tmp_path):
    assert await build(tmp_path, forms="ghosts\tghost\n").lookup("ghosts") is None


async def test_forms_are_not_tried_for_phrases(tmp_path):
    assert await build(tmp_path, forms="went on\tgo on\n").lookup("went on") is None


# ---- phrases ----

async def test_a_phrase_hits_only_when_the_phrase_tables_have_it_exactly(tmp_path):
    lookup = build(tmp_path)
    out = await lookup.lookup("Be able to")
    assert out == {"hit": True, "word": "be able to", "defs_zh": [{"pos": "", "text": "能够"}], "defs_en": [], "source": "dict"}
    assert (await lookup.lookup("by accident"))["defs_zh"][0]["text"] == "偶然"
    assert await lookup.lookup("be able") is None and await lookup.lookup("be able to do") is None
    assert (await lookup.lookup("go on"))["defs_zh"][0]["text"] == "继续"


async def test_the_phrase_table_is_built_once_for_concurrent_lookups(tmp_path, monkeypatch):
    calls = []
    real = lk._build_phrases
    monkeypatch.setattr(lk, "_build_phrases", lambda d: calls.append(1) or real(d))
    lookup = build(tmp_path)
    results = await asyncio.gather(*(lookup.lookup("be able to") for _ in range(5)))
    assert all(r["word"] == "be able to" for r in results) and len(calls) == 1


async def test_the_phrase_table_follows_a_changed_book_file(tmp_path):
    lookup = build(tmp_path)
    assert await lookup.lookup("go on") is not None
    book = tmp_path / "dict" / "junior.jsonl"
    book.write_bytes(json.dumps({"word": "stop", "translations": [{"translation": "停", "type": "v"}],
                                 "phrases": [{"phrase": "stop by", "translation": "顺便拜访"}]}).encode() + b"\n")
    assert await lookup.lookup("go on") is None
    assert (await lookup.lookup("stop by"))["defs_zh"][0]["text"] == "顺便拜访"


# ---- misses ----

@pytest.mark.parametrize("text", ["zebra", "a b c d", "x" * 41, "谈话", "", "..."])
async def test_everything_else_is_a_miss(tmp_path, text):
    assert await build(tmp_path).lookup(text) is None


# ---- degraded data ----

async def test_without_a_forms_file_headwords_still_work(tmp_path):
    lookup = build(tmp_path, forms=None)
    assert await lookup.lookup("went") is None and (await lookup.lookup("go"))["word"] == "go"


async def test_without_definitions_the_chinese_part_still_answers(tmp_path):
    out = await build(tmp_path, defs=False).lookup("talk")
    assert out["defs_en"] == [] and out["defs_zh"]


async def test_without_any_book_everything_is_a_miss(tmp_path):
    lookup = lk.DictionaryLookup(DictionaryStore(tmp_path / "nowhere"))
    assert await lookup.lookup("talk") is None and await lookup.lookup("be able to") is None


async def test_the_first_book_that_has_the_word_gives_the_card(tmp_path):
    data = make_data_dir(tmp_path, ("junior", "senior"))
    (data / "senior.jsonl").write_bytes(json.dumps({"word": "go", "us": "x", "translations": [
        {"translation": "SENIOR", "type": "v"}]}).encode() + b"\n")
    out = await lk.DictionaryLookup(DictionaryStore(data)).lookup("go")
    assert out["defs_zh"] == [{"pos": "v", "text": "去；走"}]


# ---- the forms file ----

def test_forms_loader_reads_pairs_and_skips_bad_lines_without_naming_them(tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    path = tmp_path / "wordbook-definitions" / FILE_NAME
    path.parent.mkdir()
    path.write_bytes("went\tgo\nsecretbadline\nx\t\n\ta\nfoo\tbar\tbaz\nstopped\tstop\n".encode())
    forms = Forms(path)
    assert len(forms) == 2 and forms.lemma_of("went") == "go" and forms.lemma_of("stopped") == "stop"
    assert forms.lemma_of("secretbadline") is None and forms.lemma_of("Went") is None
    assert "skipped lines=4" in caplog.text and "secretbadline" not in caplog.text and "went" not in caplog.text


def test_forms_loader_missing_file_is_empty_and_default_path_is_a_sibling(tmp_path):
    assert len(Forms(tmp_path / "none.txt")) == 0 and Forms(tmp_path / "none.txt").lemma_of("went") is None
    assert default_path(tmp_path / "dictionaries" / "kylebing-english-vocabulary") == (
        tmp_path / "dictionaries" / "wordbook-definitions" / FILE_NAME)


async def test_forms_reload_when_the_file_changes(tmp_path):
    lookup = build(tmp_path, forms="went\tgo\n")
    assert await lookup.lookup("stopped") is None
    (tmp_path / "wordbook-definitions" / FILE_NAME).write_bytes(b"stopped\tstop\nwent\tgo\n")
    assert (await lookup.lookup("stopped"))["lemma"] == "stop"


def test_the_service_follows_the_data_directory(app, tmp_path):
    first = lk.lookup_service(app)
    assert lk.lookup_service(app) is first
    app.state.settings = app.state.settings.model_copy(update={"wordbook_data_dir": str(make_data_dir(tmp_path))})
    second = lk.lookup_service(app)
    assert second is not first and lk.lookup_service(app) is second


def test_the_module_is_not_a_logging_site():
    source = (Path(lk.__file__)).read_text(encoding="utf-8")
    assert "logging" not in source and "logger" not in source
