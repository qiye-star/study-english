import asyncio

import pytest

from app.wordbook.books import BOOK_IDS, book_by_id, default_data_dir
from app.wordbook.index import DataUnavailable, DictionaryStore, build_index, dictionary
from tests.wordbook_helpers import MINI, enable_wordbook, make_data_dir


def test_build_index_dedupes_and_drops():
    idx = build_index("junior", MINI)
    assert len(idx) == 14 and idx.dropped == 2
    assert idx.keys[:3] == ("talk", "ability", "able")
    assert len(idx.offsets[idx.ordinal["talk"]]) == 2 and idx.offsets[idx.ordinal["talk"]][0] == 0
    assert idx.pos_mask[idx.ordinal["talk"]] == 3 and idx.pos_mask[idx.ordinal["able"]] == 4
    assert idx.has_example[idx.ordinal["careful"]] == 0 and idx.has_example[idx.ordinal["go"]] == 1
    assert "adj." not in idx and idx.size == MINI.stat().st_size


async def test_store_lazy_loads_reads_cards_and_caches(tmp_path):
    store = DictionaryStore(make_data_dir(tmp_path), cache_size=2)
    assert store.loaded() == {}
    cards = await store.cards("junior", ["go", "nope", "talk"])
    assert list(cards) == ["go", "talk"] and cards["talk"].examples[0].en.startswith("I could hear")
    assert set(store.loaded()) == {"junior"}
    assert (await store.card("junior", "go")) is cards["go"]  # LRU hit returns the same object
    await store.cards("junior", ["able", "child"])
    assert (await store.card("junior", "go")) is not cards["go"]  # evicted (cache_size=2)


async def test_concurrent_first_access_builds_once(tmp_path, monkeypatch):
    calls = []
    import app.wordbook.index as mod
    real = mod.build_index
    monkeypatch.setattr(mod, "build_index", lambda b, p: calls.append(b) or real(b, p))
    store = DictionaryStore(make_data_dir(tmp_path))
    await asyncio.gather(*(store.index("junior") for _ in range(5)))
    assert calls == ["junior"]


async def test_missing_book_hidden_sentences_reload_and_stale(tmp_path):
    data = make_data_dir(tmp_path)
    store = DictionaryStore(data)
    with pytest.raises(DataUnavailable):
        await store.index("toefl")
    with pytest.raises(DataUnavailable):
        await store.index("nope")
    abandon = await store.card("junior", "abandon")
    store.set_hidden({abandon.examples[0].id})
    assert (await store.card("junior", "abandon")).examples == () and store.hidden_loaded
    assert store.stale("junior") is False
    (data / "junior.jsonl").write_bytes((data / "junior.jsonl").read_bytes() + b"\n")
    assert store.stale("junior") is True
    store.reload("junior")
    assert store.loaded() == {}


async def test_corrupt_file_is_data_unavailable(tmp_path):
    data = tmp_path / "dict"
    data.mkdir()
    (data / "junior.jsonl").write_bytes(b'{"word": "ok"}\nnot json\n')
    with pytest.raises(DataUnavailable) as caught:
        await DictionaryStore(data).index("junior")
    assert caught.value.book_id == "junior"


async def test_dictionary_accessor_follows_settings(app, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    first = dictionary(app)
    assert first is dictionary(app) and first.data_dir == tmp_path / "dict"
    enable_wordbook(app, tmp_path / "other")
    assert dictionary(app).data_dir == tmp_path / "other"


# ---- 真实词典文件(spec §2.7 实测数字;一次只建一本书的索引,建完即丢,内存 < 3 MiB) ----

# (清洗合并后的键数, 被丢弃的行, 至少一条可用例句的键)
REAL_COUNTS = {
    "junior": (1985, 2, 1834), "senior": (3743, 0, 3343), "cet4": (4544, 0, 4075), "cet6": (3991, 0, 3506),
    "kaoyan": (5046, 1, 4511), "toefl": (10367, 0, 8165), "sat": (4457, 7, 3675),
}


@pytest.mark.parametrize("book_id", BOOK_IDS)
def test_real_book_index_matches_spec_counts(book_id):
    path = default_data_dir() / book_by_id(book_id).file
    idx = build_index(book_id, path)
    assert (len(idx), idx.dropped, sum(idx.has_example)) == REAL_COUNTS[book_id]
    assert idx.size == path.stat().st_size and sum(len(o) for o in idx.offsets) + idx.dropped == book_by_id(book_id).entries


async def test_real_data_dirty_headwords_and_merged_cards():
    store = DictionaryStore(default_data_dir(), cache_size=16)
    junior = await store.index("junior")
    assert "adj." not in junior and "rusia" not in junior
    sat = await store.index("sat")
    assert not {"aluminumal", "phosphorusp", "oxygen o", "iron fe", "sulfur disoxide"} & set(sat.keys)
    assert "a." not in await store.index("kaoyan")
    ability = await store.card("junior", "ability")
    assert len(junior.offsets[junior.ordinal["ability"]]) >= 2  # 书内重复行合并成一张卡
    assert ability.word == "ability" and "'" not in ability.us and ability.senses
    assert all("  " not in e.en and " ," not in e.en and "(=" not in e.en for e in ability.examples)
    store.reload()
    assert store.loaded() == {}
