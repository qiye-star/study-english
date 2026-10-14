"""识别结果 → 句子的总入口(plan 2026-10-14-library-alignment-v2 R-V9):有词级时间走词路径,没有就是 v1 原样。
「vlog」夹具复现用户那条素材的形状:开头 27 s 背景音乐、语速快、句中长停顿、音乐间隙两边的短句、40 s 硬切切在一个词中间。"""
from dataclasses import replace

from app.library import asr_chunks as ac
from app.library import segment, sentences
from app.speech.timed import Utterance, Word
from tests.library_words import chunk, utt

LINES = ["Welcome back to the show everyone.", "Today we are talking about learning English.",
         "Let us begin with a simple question."]


def test_without_word_times_the_v1_path_is_used_unchanged():
    utts = [Utterance(LINES[0], 18_000, 21_200), Utterance(LINES[1], 22_000, 26_400), Utterance(LINES[2], 27_300, 30_100)]
    chunks = [ac.Chunk(0, 40_000, " ".join(LINES), utts)]
    built = sentences.build(chunks, [])
    v1 = segment.build(ac.fragments(chunks, []), adjust=ac.snapper([]))
    assert built.algorithm == sentences.V1 and built.sentences == v1 and built.flags == [(), (), ()]
    assert built.low_confidence is False


def test_text_only_overlapping_chunks_are_deduplicated_on_the_v1_path():
    chunks = [ac.Chunk(0, 41_000, "We walk along the river and then we stop."),
              ac.Chunk(39_000, 80_000, "and then we stop. For a cup of tea today.")]
    built = sentences.build(chunks, [])
    assert built.algorithm == sentences.V1
    assert " ".join(s.text for s in built.sentences).count("and then we stop") == 1


def vlog() -> list[ac.Chunk]:
    """0-27 s music only. Speech from 27.36 s, fast (word 250 ms, gap 40 ms). Hard cut at 40 s inside 'understand';
    a 3.1 s pause inside a sentence; 'Okay.' at 60 s then 10 s of music then a new sentence; 2 s overlap."""
    a1 = utt("Hi everyone and welcome back to my channel.", 27_360, word_ms=250, gap_ms=40)
    a2 = utt("Today I want to show you how I understand the city", 37_100, word_ms=250, gap_ms=40)
    b2 = utt("I understand the city and why I love it.", 39_130 - 39_000, word_ms=250, gap_ms=40)
    b3 = utt("So we went to the market and then, honestly, we bought way too much food.", 43_000 - 39_000,
             word_ms=250, gap_ms=40, gaps={5: 3_100})
    b4 = utt("Okay.", 60_000 - 39_000, word_ms=300)
    c1 = utt("Let us go to the beach now.", 71_000 - 39_000, word_ms=250, gap_ms=40)
    return [chunk(0, 41_000, a1, a2), chunk(39_000, 80_000, b2, b3, b4, c1)]


def test_the_vlog_shape_gets_word_accurate_boundaries():
    built = sentences.build(vlog(), [])
    assert built.algorithm == sentences.WORDS
    texts = [s.text for s in built.sentences]
    assert texts[0] == "Hi everyone and welcome back to my channel."
    assert built.sentences[0].start_ms == 27_360 - 40  # the first word, not the music before it
    assert sum(t.count("understand") for t in texts) == 1  # the straddled word is kept once
    assert "So we went to the market" in texts  # split at the 3.1 s pause
    assert "Okay." in texts and texts[texts.index("Okay.") + 1] == "Let us go to the beach now."
    okay = built.sentences[texts.index("Okay.")]
    assert okay.end_ms - okay.start_ms < 1_000  # not stretched over the music
    assert all(a.end_ms <= b.start_ms for a, b in zip(built.sentences, built.sentences[1:]))
    assert all(s.end_ms > s.start_ms for s in built.sentences)


def test_the_vlog_shape_is_not_low_confidence_and_flags_line_up():
    built = sentences.build(vlog(), [])
    assert len(built.flags) == len(built.sentences)
    assert built.low_confidence is False


def test_build_is_deterministic():
    assert sentences.build(vlog(), []) == sentences.build(vlog(), [])


def test_recognizer_placeholder_words_between_the_real_ones_change_nothing():
    """The real recognizer interleaves 1-char entries timed -1/-1 with the words (Task 0 follow-up): a transcript that
    kept them must give exactly the sentences of the clean one."""
    def with_placeholders(c: ac.Chunk) -> ac.Chunk:
        utts = []
        for u in c.utterances:
            mixed: list[Word] = [Word(",", -1, -1)]
            for w in u.words:
                mixed += [w, Word(" ", -1, -1)]
            utts.append(replace(u, words=tuple(mixed)))
        return replace(c, utterances=utts)

    clean = vlog()
    assert sentences.build([with_placeholders(c) for c in clean], []) == sentences.build(clean, [])
