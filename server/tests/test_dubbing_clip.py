"""片段规则(纯函数,plan L5 S3 / R3、R6)。句子用 (start_ms, end_ms, speaker) 元组构造。"""
import pytest

from app.dubbing import clip


def seg(start, end, speaker=None):
    return clip.Seg(start_ms=start, end_ms=end, speaker=speaker)


def run(*specs):
    """连续的句子:每句 1000 ms,从 0 开始,间隔 0。specs 是 speaker 字母(或 None)。"""
    return [seg(i * 1000, i * 1000 + 1000, s) for i, s in enumerate(specs)]


@pytest.mark.parametrize("seg_from, seg_to", [(-1, 0), (0, 5), (3, 2), (5, 9)])
def test_out_of_range_or_reversed_is_a_clip_error(seg_from, seg_to):
    segs = run("A", "B", "A")
    assert clip.check(segs, seg_from, seg_to, "A") == "clip"


def test_thirteen_lines_is_too_long():
    segs = run(*(["A", "B"] * 6 + ["A"]))  # 13 lines, each 1 s: well under 90 s
    assert len(segs) == 13
    assert clip.check(segs, 0, 12, "A") == "clip_too_long"


def test_twelve_lines_over_ninety_seconds_is_too_long():
    segs = [seg(i * 7600, i * 7600 + 7500, "A" if i % 2 == 0 else "B") for i in range(12)]
    # first start 0, last end 11 * 7600 + 7500 = 91 100 > 90 000
    assert clip.check(segs, 0, 11, "A") == "clip_too_long"


def test_exactly_twelve_lines_and_exactly_ninety_seconds_is_allowed():
    segs = [seg(i * 7500, i * 7500 + 7500, "A" if i % 2 == 0 else "B") for i in range(12)]
    # first start 0, last end 11 * 7500 + 7500 = 90 000
    assert segs[-1].end_ms == 90_000
    assert clip.check(segs, 0, 11, "A") is None


def test_role_with_no_lines_in_the_clip_is_missing():
    segs = run("A", "B", "A")
    assert clip.check(segs, 0, 2, "C") == "role_missing"
    assert clip.check(segs, 1, 1, "A") == "role_missing"  # the only line is B


def test_monologue_is_allowed():
    segs = run("A", "A", "A")
    assert clip.check(segs, 0, 2, "A") is None


def test_unlabelled_lines_count_as_the_other_side_and_do_not_satisfy_a_role():
    segs = run(None, None, "B")
    assert clip.check(segs, 0, 1, "A") == "role_missing"
    assert clip.check(segs, 0, 2, "B") is None


def test_mine_returns_the_role_lines_in_the_clip_in_order():
    segs = run("A", "B", None, "A", "B")
    assert clip.mine(segs, 0, 4, "A") == [0, 3]
    assert clip.mine(segs, 1, 2, "A") == []
    assert clip.mine(segs, 0, 4, "F") == []


def test_speakers_in_lists_only_letters_that_occur_sorted():
    segs = run("C", None, "A", "C")
    assert clip.speakers_in(segs, 0, 3) == ["A", "C"]
    assert clip.speakers_in(segs, 1, 1) == []


def test_constants_are_the_placeholder_values():
    assert clip.MAX_LINES == 12
    assert clip.MAX_MS == 90_000
    assert clip.ROLE_KEYS == ("A", "B", "C", "D", "E", "F")
    assert clip.MAX_ROLES == 6


@pytest.mark.parametrize("raw, expected", [("a", "A"), (" b ", "B"), ("F", "F"), ("G", None), ("", None), (None, None),
                                           (1, None), ("AA", None)])
def test_clean_role(raw, expected):
    assert clip.clean_role(raw) == expected


@pytest.mark.parametrize("raw, expected", [
    ("  Mr   Smith ", "Mr Smith"),
    ("x" * 24, "x" * 24),
    ("x" * 25, None),
    ("   ", None),
    ("", None),
    (None, None),
    (42, None),
])
def test_clean_name_collapses_spaces_and_limits_length(raw, expected):
    assert clip.clean_name(raw) == expected
