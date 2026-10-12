"""Hand-written function-word definitions (plan 2026-10-12 D1). Standalone: needs no build script."""
import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "dictionaries" / "wordbook-definitions"
CLOSED_POS = {"prep", "pron", "conj", "art", "num", "aux", "int"}
COMMON = {"the", "a", "in", "of", "and", "to", "it", "that", "for", "with", "on", "against", "although", "during",
          "because", "her", "him"}


def _lines():
    raw = (DATA / "function-words.jsonl").read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf") and b"\r" not in raw and raw.endswith(b"\n")
    return [json.loads(line) for line in raw.decode("utf-8").splitlines()]


def test_file_is_sorted_unique_and_covers_the_common_function_words():
    rows = _lines()
    words = [r["word"] for r in rows]
    assert words == sorted(words) and len(set(words)) == len(words)
    assert len(words) >= 60 and COMMON <= set(words)


def test_every_definition_is_valid():
    for row in _lines():
        assert set(row) == {"word", "defs"} and re.fullmatch(r"[a-z]+", row["word"])
        assert row["defs"]
        seen = set()
        for d in row["defs"]:
            assert set(d) == {"pos", "text", "src"} and d["src"] == "hand"
            assert d["pos"] in CLOSED_POS and d["pos"] not in seen  # one entry per POS
            seen.add(d["pos"])
            text = d["text"]
            assert text.strip() == text and text and "\n" not in text
            assert len(text.split()) <= 12, (row["word"], text)
            assert text.isascii()


def test_licence_files_exist_and_are_lf_utf8():
    for name in ("LICENSE-OEWN", "LICENSE-ECDICT"):
        raw = (DATA / name).read_bytes()
        assert b"\r" not in raw and not raw.startswith(b"\xef\xbb\xbf")
        raw.decode("utf-8")
    assert "Permission is hereby granted" in (DATA / "LICENSE-ECDICT").read_text(encoding="utf-8")
    assert "creativecommons.org/licenses/by/4.0" in (DATA / "LICENSE-OEWN").read_text(encoding="utf-8")
