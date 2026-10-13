"""字幕解析(spec §6.3「解析」):表驱动。"""
import pytest

from app.library.errors import LibraryError
from app.library.subtitles import Cue, clean_line, decode, parse

SRT = """1
00:00:01,000 --> 00:00:02,500
Hello there.

2
00:00:02,600 --> 00:00:04,000
How are you?
I'm fine.
"""

VTT = """WEBVTT
Kind: captions
Language: en

NOTE this is a comment
with two lines

STYLE
::cue { color: yellow }

intro
00:01.000 --> 00:02.000 align:start position:0%
<c.colorE5E5E5>Good</c> <i>morning</i>

00:00:02.500 --> 00:00:03.250
Tom &amp; Jerry
"""


def test_srt_basic():
    assert parse(SRT.encode()) == [Cue(1000, 2500, "Hello there."), Cue(2600, 4000, "How are you? I'm fine.")]


def test_webvtt_skips_header_note_style_and_cue_settings():
    assert parse(VTT.encode()) == [Cue(1000, 2000, "Good morning"), Cue(2500, 3250, "Tom & Jerry")]


@pytest.mark.parametrize("data", [
    SRT.replace("\n", "\r\n").encode(),
    b"\xef\xbb\xbf" + SRT.encode(),
    SRT.encode("utf-16"),
], ids=["crlf", "utf8-bom", "utf16"])
def test_line_endings_and_encodings(data):
    assert [c.text for c in parse(data)] == ["Hello there.", "How are you? I'm fine."]


def test_latin1_fallback_never_raises():
    data = "1\n00:00:01,000 --> 00:00:02,000\nCaf\xe9 au lait\n".encode("latin-1")
    assert parse(data) == [Cue(1000, 2000, "Café au lait")]


@pytest.mark.parametrize("stamp, ms", [
    ("00:00:01,5", 1500), ("00:00:01,05", 1050), ("01:02:03,004", 3723004), ("02:03.004", 123004), ("1:02:03.4", 3723400),
])
def test_timestamp_forms(stamp, ms):
    cues = parse(f"{stamp} --> 99:00:00,000\nWord here\n".encode())
    assert cues[0].start_ms == ms


@pytest.mark.parametrize("raw, cleaned", [
    ("[Music]", ""),
    ("(applause)", ""),
    ("(MUSIC PLAYING) Let's go.", "Let's go."),
    ("I said (quietly, to myself) no.", "I said (quietly, to myself) no."),
    ("♪ la la la ♪", "la la la"),
    ("- Are you sure?", "Are you sure?"),
    (">> SPEAKER: hello", "SPEAKER: hello"),
    ("{\\an8}Top line", "Top line"),
    ("<font color=\"#fff\">White</font> <b>bold</b>", "White bold"),
    ("It&#39;s&nbsp;fine", "It's fine"),
    ("你好,今天怎么样?", ""),
    ("Hello 你好", "Hello 你好"),
    ("...", ""),
])
def test_clean_line(raw, cleaned):
    assert clean_line(raw) == cleaned


def test_bilingual_subtitles_keep_only_the_english_line():
    data = "1\n00:00:01,000 --> 00:00:02,000\nWhere are you going?\n你要去哪里?\n".encode()
    assert parse(data) == [Cue(1000, 2000, "Where are you going?")]


def test_out_of_order_and_overlapping_cues_are_sorted_and_kept():
    data = ("2\n00:00:03,000 --> 00:00:04,000\nSecond.\n\n"
            "1\n00:00:01,000 --> 00:00:03,500\nFirst.\n\n"
            "3\n00:00:05,000 --> 00:00:04,000\nBackwards end is dropped.\n").encode()
    assert parse(data) == [Cue(1000, 3500, "First."), Cue(3000, 4000, "Second.")]


def test_rolling_auto_captions_keep_only_the_new_tail():
    data = ("1\n00:00:01,000 --> 00:00:03,000\nso today we are\n\n"
            "2\n00:00:03,000 --> 00:00:05,000\nso today we are\ngoing to talk about\n\n"
            "3\n00:00:05,000 --> 00:00:07,000\ngoing to talk about\nshadowing practice\n").encode()
    assert [c.text for c in parse(data)] == ["so today we are", "going to talk about", "shadowing practice"]


@pytest.mark.parametrize("data", [
    b"",
    b"just some text without any timing\n",
    b"1\n00:00:01,000 --> 00:00:02,000\n[Music]\n",
    bytes(range(256)) * 20,
    b"x" * (2 * 1_048_576 + 1),
], ids=["empty", "no-timing", "music-only", "binary", "too-big"])
def test_bad_files(data):
    with pytest.raises(LibraryError) as e:
        parse(data)
    assert e.value.kind == "bad_subtitle"


def test_too_many_cues():
    one = "00:00:01,000 --> 00:00:02,000\nA word\n\n"
    with pytest.raises(LibraryError):
        parse((one * 20_001).encode())


def test_decode_rejects_mostly_control_characters():
    with pytest.raises(LibraryError):
        decode(b"\x01\x02\x03\x04" * 100)
