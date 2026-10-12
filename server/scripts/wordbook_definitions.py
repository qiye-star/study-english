#!/usr/bin/env python3
"""Build / verify / check / fill the wordbook English definitions (spec 2026-10-12-wordbook-definitions §3).

Offline operator tool; `app/` never imports it and nothing here runs at request time. From server/:
  uv run python scripts/wordbook_definitions.py verify  --sources D:\\tmp-ecdict
  uv run python scripts/wordbook_definitions.py build   --sources D:\\tmp-ecdict
  uv run python scripts/wordbook_definitions.py check
  uv run python scripts/wordbook_definitions.py llm-fill            # needs the LLM upstream (dev machine only)
`--sources` defaults to the env var WORDBOOK_DEFS_SOURCES. Output is deterministic: the same inputs give
byte-identical files. Never prints keys, prompts or replies; only counts and words from the public word lists.
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import hashlib
import json
import os
import random
import re
import sqlite3
import sys
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Protocol

SERVER = Path(__file__).resolve().parents[1]
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

from app.wordbook.entry import headword_key  # noqa: E402  (same normalisation as BookIndex keys)

DATA_DIR = SERVER / "dictionaries" / "wordbook-definitions"
BOOKS_DIR = SERVER / "dictionaries" / "kylebing-english-vocabulary"
BOOK_IDS = ("junior", "senior", "cet4", "cet6", "kaoyan", "toefl", "sat")
SCRIPT_VERSION = 1
MAX_PER_POS = 2
LONG_GLOSS_WORDS = 14       # glosses longer than this go behind the shorter ones (stable)
MAX_PAREN_WORDS = 4         # parentheses with more words are dropped from a gloss
LLM_MAX_WORDS = 12          # also the limit for hand-written entries
LLM_BATCH = 40
SPOT_CHECK_PCT = 5
OPEN_POS = ("n", "v", "a", "r")
CLOSED_POS = ("prep", "pron", "conj", "art", "num", "aux", "int")
ALL_POS = OPEN_POS + CLOSED_POS
SRC_VALUES = ("oewn", "hand", "llm")
CATEGORIES = ("function", "proper", "abbr", "compound", "pos_mismatch", "other")
FILES = {"definitions": "definitions.jsonl", "hand": "function-words.jsonl", "llm": "definitions-llm.jsonl",
         "missing": "missing.txt", "manifest": "SOURCE.json"}

INPUTS = {
    "oewn": {"name": "Open English WordNet", "version": "2025", "license": "CC BY 4.0",
             "homepage": "https://en-word.net/", "file": "english-wordnet-2025-index.sense-fixed.zip",
             "bytes": 9_616_299, "sha256": "38b16326159f51853626b7d24a44c453fa88ab33f06fce5ec8fc5996d1c2be93"},
    "ecdict": {"name": "ECDICT", "version": "1.0.28", "license": "MIT",
               "homepage": "https://github.com/skywind3000/ECDICT", "file": "ecdict-sqlite-28.zip",
               "bytes": 216_765_132, "sha256": "ea01f76a3b3351021ce47077e89234465cc9441c8793054495320d06c0c3f3f6"},
}
ECDICT_DB = "stardict.db"
ECDICT_DB_BYTES = 851_288_064



# ---------------------------------------------------------------- hashing / io

def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)  # bytes, never text mode: LF on Windows too


def dump_line(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))



# ---------------------------------------------------------------- part of speech

_POS_TOKEN = {
    "n": "n", "noun": "n", "v": "v", "vt": "v", "vi": "v", "verb": "v", "a": "a", "adj": "a", "adjective": "a",
    "ad": "r", "adv": "r", "adverb": "r", "prep": "prep", "pron": "pron", "conj": "conj", "conjunction": "conj",
    "art": "art", "determiner": "art", "indefinite article": "art", "definite article": "art", "num": "num",
    "aux": "aux", "modal verb": "aux", "modalverb": "aux", "modal": "aux", "int": "int", "interj": "int",
    "interjection": "int",
}
_POS_SPLIT = re.compile(r"[&/,]")


def pos_tokens(type_str: str | None) -> list[str]:
    """Raw lower-case tokens of a book `type` such as 'a&ad' -> ['a', 'ad'] (punctuation dots dropped)."""
    out = []
    for part in _POS_SPLIT.split((type_str or "").lower()):
        token = part.strip().strip(".").strip()
        if token:
            out.append(token)
    return out


def map_pos(type_str: str | None) -> list[str]:
    """Canonical POS list for a book `type` (order kept, no duplicates); unknown tokens (abbr, neg, garbage) vanish."""
    out: list[str] = []
    for token in pos_tokens(type_str):
        pos = _POS_TOKEN.get(token)
        if pos and pos not in out:
            out.append(pos)
    return out



# ---------------------------------------------------------------- gloss cleaning

_QUOTED = re.compile(r'"[^"]*"')


def _first_clause(text: str) -> str:
    depth = 0
    for i, ch in enumerate(text):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif ch == ";" and depth == 0:
            return text[:i]
    return text


def _drop_long_parens(text: str) -> str:
    """Remove every outermost (...) group with more than MAX_PAREN_WORDS words (nested groups count as part of it)."""
    out: list[str] = []
    depth = start = last = 0
    for i, ch in enumerate(text):
        if ch == "(":
            if depth == 0:
                start = i
            depth += 1
        elif ch == ")" and depth > 0:
            depth -= 1
            if depth == 0 and len(text[start + 1:i].split()) > MAX_PAREN_WORDS:
                out.append(text[last:start])
                last = i + 1
    out.append(text[last:])
    return "".join(out)


def clean_gloss(gloss: str) -> str:
    """WordNet gloss -> one short definition: first clause (examples come after ';'), no quoted text, long
    parentheses dropped, spaces and trailing punctuation tidied. May return ''."""
    text = _drop_long_parens(_QUOTED.sub("", _first_clause(gloss or "")))
    if text.count("(") != text.count(")"):
        text = text.replace("(", "").replace(")", "")
    return " ".join(text.split()).strip(" ;,:-")


def pick_texts(glosses: list[str], limit: int = MAX_PER_POS) -> list[str]:
    """Clean in sense order, drop empties and duplicates, move > LONG_GLOSS_WORDS-word glosses behind the shorter
    ones (stable), keep `limit`."""
    seen: set[str] = set()
    short: list[str] = []
    long: list[str] = []
    for gloss in glosses:
        text = clean_gloss(gloss)
        if not text or text.casefold() in seen:
            continue
        seen.add(text.casefold())
        (long if len(text.split()) > LONG_GLOSS_WORDS else short).append(text)
    return (short + long)[:limit]
