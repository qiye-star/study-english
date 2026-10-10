from app.wordbook.cloze import MAX_LINES, Segment, best_example, build_set, line_for, set_id_for
from app.wordbook.entry import Example, WordCard, sentence_id
from app.wordbook.index import DictionaryStore
from tests.wordbook_helpers import make_data_dir


async def load(tmp_path):
    store = DictionaryStore(make_data_dir(tmp_path))
    index = await store.index("junior")
    return await store.cards("junior", list(index.keys))


def card_with(key: str, *sentences: str) -> WordCard:
    examples = tuple(Example(sentence_id(s), s, "") for s in sentences)
    return WordCard(key, key, "", "", (), (), examples, 2)


def joined(line) -> str:
    return "".join(s.v if s.t == "text" else "#" * s.len for s in line.segments)


async def test_best_example_prefers_exact_mid_length(tmp_path):
    c = await load(tmp_path)
    assert best_example(c["talk"]).en == "After a long talk, we decided on divorce."
    assert best_example(c["careful"]) is None


async def test_line_for_single_word_and_phrase(tmp_path):
    c = await load(tmp_path)
    line = line_for(c["go"], start=4)
    assert line.expected == ("went",) and line.lemmas == ("go",)
    assert line.segments == (Segment("text", "She "), Segment("blank", i=4, len=4),
                             Segment("text", " home early because she felt tired."))
    phrase = line_for(c["used to"])
    assert phrase.expected == ("used", "to") and phrase.lemmas == ("used", "to")
    assert [s.t for s in phrase.segments] == ["text", "blank", "text", "blank", "text"]
    assert joined(phrase) == "I #### ## live in a small town by the sea."
    assert line_for(c["careful"]) is None


async def test_line_for_rebuilds_by_sentence_id(tmp_path):
    c = await load(tmp_path)
    sid = c["talk"].examples[0].id
    assert line_for(c["talk"], sid).expected == ("talking",)
    assert line_for(c["talk"], "0" * 16) is None


def test_line_for_skips_unspellable_and_keeps_text_between_phrase_words():
    assert line_for(card_with("mr.", "Mr. Smith is our new English teacher.")) is None
    line = line_for(card_with("carbon dioxide", "Plants take in carbon  dioxide during the day."))
    assert line is not None and line.expected == ("carbon", "dioxide")
    blanks = [s for s in line.segments if s.t == "blank"]
    assert [b.len for b in blanks] == [6, 7]
    assert joined(line) == "Plants take in ######  ####### during the day."  # 词间原文照抄


async def test_build_set_numbers_blanks_and_needs_three_lines(tmp_path):
    c = await load(tmp_path)
    s = build_set([c["used to"], c["go"], c["careful"], c["child"], c["stop"]], size=5)
    assert [l.key for l in s.lines] == ["used to", "go", "child", "stop"]
    blanks = [seg.i for l in s.lines for seg in l.segments if seg.t == "blank"]
    assert blanks == [0, 1, 2, 3, 4] and len(s.set_id) == 12
    assert s.set_id == set_id_for(s.lines)
    assert build_set([c["go"], c["careful"]]) is None


async def test_build_set_caps_size_and_skips_repeated_sentences(tmp_path):
    c = await load(tmp_path)
    many = [c[k] for k in ("talk", "ability", "able", "abandon", "absorb", "accept", "accident", "go", "child")]
    assert len(build_set(many, size=99).lines) == MAX_LINES
    assert len(build_set(many, size=1).lines) == 3
    twin = card_with("talk", "After a long talk, we decided on divorce.")
    assert build_set([c["talk"], twin, c["go"], c["child"]]).lines[1].key == "go"
