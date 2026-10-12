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


# ---------------------------------------------------------------- inputs: WordNet, ECDICT

_SS_POS = {"1": "n", "2": "v", "3": "a", "4": "r", "5": "a"}
_DATA_POS = {"data.noun": "n", "data.verb": "v", "data.adj": "a", "data.adv": "r"}
_EXC_POS = {"noun.exc": "n", "verb.exc": "v", "adj.exc": "a", "adv.exc": "r"}


@dataclass
class WordNet:
    senses: dict[tuple[str, str], list[tuple[int, str]]] = field(default_factory=dict)  # (lemma, pos) -> [(sense_number, offset)]
    glosses: dict[tuple[str, str], str] = field(default_factory=dict)                  # (pos, offset) -> gloss
    exceptions: dict[tuple[str, str], list[str]] = field(default_factory=dict)         # (pos, inflected) -> lemmas

    def gloss_list(self, lemma: str, pos: str) -> list[str]:
        """Glosses of one lemma+POS in WordNet sense order (`tag_cnt` is 0 everywhere in this release)."""
        found = sorted(self.senses.get((lemma.replace(" ", "_"), pos), ()))
        return [self.glosses[(pos, off)] for _, off in found if (pos, off) in self.glosses]


def read_wordnet(zip_path: Path) -> WordNet:
    wn = WordNet()
    with zipfile.ZipFile(zip_path) as zf:
        members = {Path(i.filename).name: i for i in zf.infolist() if not i.is_dir()}

        def lines(name: str):
            with zf.open(members[name]) as raw:
                for line in raw.read().decode("utf-8").split("\n"):
                    yield line.rstrip("\r")

        for line in lines("index.sense"):
            parts = line.split()
            if len(parts) != 4:
                continue
            lemma, _, rest = parts[0].rpartition("%")
            pos = _SS_POS.get(rest.split(":", 1)[0])
            if pos:
                wn.senses.setdefault((lemma, pos), []).append((int(parts[2]), parts[1]))
        for name, pos in _DATA_POS.items():
            for line in lines(name):
                if line.startswith("  ") or not line.strip():  # license header
                    continue
                head, sep, gloss = line.partition(" | ")
                if sep and head.split():
                    wn.glosses[(pos, head.split()[0])] = gloss.strip()
        for name, pos in _EXC_POS.items():
            if name not in members:
                continue
            for line in lines(name):
                parts = line.split()
                if len(parts) >= 2:
                    wn.exceptions[(pos, parts[0])] = parts[1:]
    return wn


@dataclass(frozen=True)
class EcdictInfo:
    lemma: str | None
    frq: int


def parse_exchange(exchange: str | None) -> str | None:
    """`exchange` is 'p:went/d:gone/0:go/1:p' -> the lemma ('go'), or None."""
    for item in (exchange or "").split("/"):
        key, _, value = item.partition(":")
        if key == "0" and value.strip():
            return value.strip().lower()
    return None


def read_ecdict(db_path: Path, words: set[str]) -> dict[str, EcdictInfo]:
    """Lemma + frequency rank (`frq`, smaller = commoner, 0 = unknown) for the wanted words only."""
    out: dict[str, EcdictInfo] = {}
    con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        for word, exchange, frq in con.execute("select word, exchange, frq from stardict order by rowid"):
            low = (word or "").lower()
            if low in words and (low not in out or word == low):  # the exact lower-case row wins
                out[low] = EcdictInfo(parse_exchange(exchange), int(frq or 0))
    finally:
        con.close()
    return out



# ---------------------------------------------------------------- the word books

@dataclass
class WordInfo:
    key: str
    raw: set[str] = field(default_factory=set)
    pos: list[str] = field(default_factory=list)
    abbr: bool = False       # a book row typed it 'abbr'
    untyped: bool = False    # some row had no usable POS token


def collect_wanted(books_dir: Path, book_ids: tuple[str, ...] = BOOK_IDS) -> tuple[dict[str, WordInfo], int]:
    """(key -> WordInfo in first-seen order, number of rows BookIndex would drop). Keys equal BookIndex keys."""
    wanted: dict[str, WordInfo] = {}
    dropped = 0
    for book in book_ids:
        with (books_dir / f"{book}.jsonl").open("rb") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                key = headword_key(row.get("word", ""))
                if key is None:
                    dropped += 1
                    continue
                info = wanted.setdefault(key, WordInfo(key))
                info.raw.add((row.get("word") or "").strip())
                types = [t.get("type") for t in row.get("translations") or []]
                if not types:
                    info.untyped = True
                for type_str in types:
                    mapped = map_pos(type_str)
                    if "abbr" in pos_tokens(type_str):
                        info.abbr = True
                    if not mapped:
                        info.untyped = True
                    for pos in mapped:
                        if pos not in info.pos:
                            info.pos.append(pos)
    return wanted, dropped



# ---------------------------------------------------------------- extras (hand / llm)

class ExtrasError(ValueError):
    pass


def validate_def(pos: str, text: str, src: str) -> str | None:
    """Reason a hand / llm definition is unusable, else None."""
    if pos not in ALL_POS:
        return "pos"
    if not isinstance(text, str) or not text.strip() or text != " ".join(text.split()):
        return "text"
    if re.search(r"[\u3400-\u9fff\uf900-\ufaff]", text) or "\n" in text:
        return "cjk"
    if len(text.split()) > LLM_MAX_WORDS:
        return "long"
    if src not in ("hand", "llm"):
        return "src"
    return None


def read_extras(path: Path, src: str, *, strict: bool) -> dict[str, dict[str, list[str]]]:
    """word -> pos -> texts from function-words.jsonl (strict: any problem raises) or definitions-llm.jsonl."""
    out: dict[str, dict[str, list[str]]] = {}
    if not path.is_file():
        return out
    for number, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            word, defs = row["word"], row["defs"]
            for d in defs:
                reason = validate_def(d["pos"], d["text"], src)
                if reason or d.get("src") != src:
                    raise ExtrasError(f"{path.name}:{number}: bad def ({reason or 'src'})")
                bucket = out.setdefault(word, {}).setdefault(d["pos"], [])
                if d["text"] not in bucket:
                    bucket.append(d["text"])
        except (KeyError, TypeError, ValueError) as e:
            if strict:
                raise ExtrasError(f"{path.name}:{number}: {type(e).__name__}") from None
    return out



# ---------------------------------------------------------------- build

@dataclass(frozen=True)
class Gap:
    word: str
    pos: tuple[str, ...]
    category: str
    frq: int


@dataclass
class BuildResult:
    entries: list[tuple[str, list[dict]]]
    gaps: list[Gap]
    stats: dict


def find_defs(wn: WordNet, word: str, pos: str, lemma_hint: str | None) -> list[str]:
    """Exact lemma first, then WordNet's irregular-form list, then ECDICT's lemma (one hop)."""
    candidates = [word, *wn.exceptions.get((pos, word), ())]
    if lemma_hint:
        candidates.append(lemma_hint)
    seen: set[str] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        texts = pick_texts(wn.gloss_list(candidate, pos))
        if texts:
            return texts
    return []


def _has_other_pos(wn: WordNet, word: str, lemma_hint: str | None) -> bool:
    names = {word, *(l for p in OPEN_POS for l in wn.exceptions.get((p, word), ())), *([lemma_hint] if lemma_hint else [])}
    return any(wn.senses.get((n.replace(" ", "_"), p)) for n in names for p in OPEN_POS)


def categorize(info: WordInfo, missing_pos: list[str], other_pos_exists: bool) -> str:
    if any(p in CLOSED_POS for p in missing_pos):
        return "function"
    raws = info.raw or {info.key}
    if info.abbr or any("." in r or (len(r) >= 2 and r.isupper()) for r in raws):
        return "abbr"
    if any(r[:1].isupper() for r in raws):
        return "proper"
    if " " in info.key or "-" in info.key:
        return "compound"
    if other_pos_exists:
        return "pos_mismatch"
    return "other"


def build_entries(wanted: dict[str, WordInfo], wn: WordNet, ecdict: dict[str, EcdictInfo],
                  hand: dict[str, dict[str, list[str]]], llm: dict[str, dict[str, list[str]]]) -> BuildResult:
    """Merge per (word, POS): hand > oewn > llm. Closed-class POS never read WordNet (spec §2)."""
    entries: list[tuple[str, list[dict]]] = []
    gaps: list[Gap] = []
    src_pairs: collections.Counter = collections.Counter()
    words_with_oewn = partial_open = 0
    for key in sorted(wanted):
        info = wanted[key]
        hint = ecdict.get(key).lemma if key in ecdict else None
        defs: list[dict] = []
        missing: list[str] = []
        used_oewn = False
        for pos in info.pos:
            found, src = [], ""
            if hand.get(key, {}).get(pos):
                found, src = hand[key][pos][:MAX_PER_POS], "hand"
            elif pos in OPEN_POS and (texts := find_defs(wn, key, pos, hint)):
                found, src = texts, "oewn"
            elif llm.get(key, {}).get(pos):
                found, src = llm[key][pos][:MAX_PER_POS], "llm"
            if not found:
                missing.append(pos)
                continue
            used_oewn = used_oewn or src == "oewn"
            src_pairs[src] += 1
            defs.extend({"pos": pos, "text": text, "src": src} for text in found)
        words_with_oewn += used_oewn
        if defs:
            entries.append((key, defs))
        closed_missing = [p for p in missing if p in CLOSED_POS]
        if defs and missing and not closed_missing:
            partial_open += 1  # e.g. a noun+verb word that WordNet only has as a noun: no English line for the verb
        if not defs or closed_missing:
            gap_pos = missing if not defs else closed_missing
            gaps.append(Gap(key, tuple(gap_pos) or ("-",), categorize(info, gap_pos, _has_other_pos(wn, key, hint)),
                            ecdict[key].frq if key in ecdict else 0))
    order = {c: i for i, c in enumerate(CATEGORIES)}
    gaps.sort(key=lambda g: (order[g.category], g.frq <= 0, g.frq, g.word))
    stats = {
        "words_wanted": len(wanted), "words_with_defs": len(entries), "words_with_oewn": words_with_oewn,
        "defs": sum(len(d) for _, d in entries),
        "pairs": {s: src_pairs.get(s, 0) for s in SRC_VALUES},
        "partial_open_pos": partial_open, "gaps": len(gaps), "gap_categories": {c: sum(1 for g in gaps if g.category == c) for c in CATEGORIES},
    }
    return BuildResult(entries, gaps, stats)


def render_definitions(entries: list[tuple[str, list[dict]]]) -> bytes:
    return "".join(dump_line({"word": w, "defs": d}) + "\n" for w, d in entries).encode("utf-8")


def render_missing(gaps: list[Gap]) -> bytes:
    return "".join(f"{g.word}\t{','.join(g.pos)}\t{g.category}\t{g.frq}\n" for g in gaps).encode("utf-8")


def read_missing(path: Path) -> list[Gap]:
    out = []
    for line in path.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            word, pos, category, frq = line.split("\t")
            out.append(Gap(word, tuple(pos.split(",")), category, int(frq)))
    return out



# ---------------------------------------------------------------- sources layout, verify

def find_file(root: Path, name: str) -> Path | None:
    hits = sorted(p for p in root.rglob(name) if p.is_file())
    return hits[0] if hits else None


def verify(root: Path) -> list[str]:
    """Problems with the pinned input zips found under `root` (empty list = ok)."""
    problems = []
    for spec in INPUTS.values():
        path = find_file(root, spec["file"])
        if path is None:
            problems.append(f"{spec['file']}: missing")
        elif path.stat().st_size != spec["bytes"]:
            problems.append(f"{spec['file']}: size {path.stat().st_size} != {spec['bytes']}")
        elif sha256_of(path) != spec["sha256"]:
            problems.append(f"{spec['file']}: sha256 mismatch")
    return problems


def ecdict_db(root: Path, work: Path) -> Path:
    """An already extracted stardict.db under root of the right size, else extract the zip into `work`."""
    for hit in sorted(root.rglob(ECDICT_DB)):
        if hit.is_file() and hit.stat().st_size == ECDICT_DB_BYTES:
            return hit
    zip_path = find_file(root, INPUTS["ecdict"]["file"])
    if zip_path is None:
        raise SystemExit("ecdict: stardict.db and ecdict-sqlite-28.zip both missing")
    target = work / ECDICT_DB
    if not (target.is_file() and target.stat().st_size == ECDICT_DB_BYTES):
        work.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extract(ECDICT_DB, work)
    return target



# ---------------------------------------------------------------- manifest / build / check

def _file_entry(path: Path, **extra) -> dict:
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": sha256_of(path), **extra}


def _line_count(path: Path) -> int:
    return sum(1 for line in path.read_bytes().split(b"\n") if line.strip())


def build_manifest(data_dir: Path, result: BuildResult, built: str, books_manifest_sha: str) -> dict:
    files = [_file_entry(data_dir / FILES["definitions"], entries=len(result.entries)),
             _file_entry(data_dir / FILES["missing"], entries=len(result.gaps))]
    for key in ("hand", "llm"):
        if (data_dir / FILES[key]).is_file():
            files.append(_file_entry(data_dir / FILES[key], entries=_line_count(data_dir / FILES[key])))
    return {
        "schema": 1, "script": "scripts/wordbook_definitions.py", "script_version": SCRIPT_VERSION, "built": built,
        "inputs": [{"id": i, **{k: v for k, v in spec.items()}} for i, spec in INPUTS.items()]
                  + [{"id": "books", "name": "kylebing-english-vocabulary", "manifest_sha256": books_manifest_sha}],
        "rules": {"max_per_pos": MAX_PER_POS, "long_gloss_words": LONG_GLOSS_WORDS, "max_paren_words": MAX_PAREN_WORDS,
                  "sense_order": "sense_number", "closed_pos_from_wordnet": False},
        "files": files, "stats": result.stats,
    }


def build(sources: Path | None, data_dir: Path = DATA_DIR, books_dir: Path = BOOKS_DIR, *, built: str | None = None,
          work: Path | None = None, wordnet_zip: Path | None = None, ecdict_path: Path | None = None) -> BuildResult:
    """Write definitions.jsonl, missing.txt and SOURCE.json into `data_dir`. `wordnet_zip` / `ecdict_path` override
    the discovery under `sources` (tests use small fixtures)."""
    wanted, _ = collect_wanted(books_dir)
    if wordnet_zip is None:
        zip_path = find_file(sources, INPUTS["oewn"]["file"]) if sources else None
        if zip_path is None:
            raise SystemExit("oewn zip not found; pass --sources or set WORDBOOK_DEFS_SOURCES")
        wordnet_zip = zip_path
    if ecdict_path is None:
        ecdict_path = ecdict_db(sources, work or Path(tempfile.gettempdir()) / "wordbook-defs-work")
    wn = read_wordnet(wordnet_zip)
    ecdict = read_ecdict(ecdict_path, set(wanted))
    hand = read_extras(data_dir / FILES["hand"], "hand", strict=True)
    unknown = sorted(w for w in hand if w not in wanted)
    if unknown:
        raise SystemExit(f"{FILES['hand']}: words not in any book: {', '.join(unknown[:10])}")
    stray = sorted(f"{w}:{p}" for w, by_pos in hand.items() for p in by_pos if p not in wanted[w].pos)
    if stray:
        raise SystemExit(f"{FILES['hand']}: POS the books do not give the word: {', '.join(stray[:10])}")
    llm = read_extras(data_dir / FILES["llm"], "llm", strict=False)
    result = build_entries(wanted, wn, ecdict, hand, llm)
    write_bytes(data_dir / FILES["definitions"], render_definitions(result.entries))
    write_bytes(data_dir / FILES["missing"], render_missing(result.gaps))
    manifest_path = data_dir / FILES["manifest"]
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    same = any(f.get("file") == FILES["definitions"] and f.get("sha256") == sha256_of(data_dir / FILES["definitions"])
               for f in previous.get("files", []))
    day = built or (previous.get("built") if same else None) or datetime.now(timezone.utc).date().isoformat()
    date.fromisoformat(day)
    books_sha = sha256_of(books_dir / "SOURCE.json") if (books_dir / "SOURCE.json").is_file() else ""
    manifest = build_manifest(data_dir, result, day, books_sha)
    write_bytes(manifest_path, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return result


def check(data_dir: Path = DATA_DIR) -> list[str]:
    """SOURCE.json vs the files next to it, plus the schema rules of definitions.jsonl (empty list = ok)."""
    manifest_path = data_dir / FILES["manifest"]
    if not manifest_path.is_file():
        return ["SOURCE.json: missing"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    problems = []
    for entry in manifest["files"]:
        path = data_dir / entry["file"]
        if not path.is_file():
            problems.append(f"{entry['file']}: missing")
        elif path.stat().st_size != entry["bytes"]:
            problems.append(f"{entry['file']}: size {path.stat().st_size} != {entry['bytes']}")
        elif sha256_of(path) != entry["sha256"]:
            problems.append(f"{entry['file']}: sha256 mismatch")
        elif entry["file"].endswith((".jsonl", ".txt")) and _line_count(path) != entry["entries"]:
            problems.append(f"{entry['file']}: entries {_line_count(path)} != {entry['entries']}")
    problems += definitions_problems(data_dir / FILES["definitions"])
    return problems


def definitions_problems(path: Path) -> list[str]:
    """Schema rules the runtime loader relies on."""
    if not path.is_file():
        return [f"{path.name}: missing"]
    problems, previous = [], ""
    for number, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
        if not line:
            continue
        row = json.loads(line)
        word, defs = row.get("word"), row.get("defs")
        if not isinstance(word, str) or word != word.lower() or headword_key(word) != word:
            problems.append(f"line {number}: bad word")
        elif word <= previous:
            problems.append(f"line {number}: not sorted ({word})")
        previous = word if isinstance(word, str) else previous
        if not defs:
            problems.append(f"line {number}: no defs ({word})")
            continue
        per_pos = collections.Counter()
        for d in defs:
            per_pos[d.get("pos")] += 1
            if d.get("pos") not in ALL_POS or d.get("src") not in SRC_VALUES or not str(d.get("text", "")).strip():
                problems.append(f"line {number}: bad def ({word})")
        if any(n > MAX_PER_POS for n in per_pos.values()):
            problems.append(f"line {number}: more than {MAX_PER_POS} per POS ({word})")
    return problems


# ---------------------------------------------------------------- llm-fill

class LlmClient(Protocol):
    async def complete(self, messages: list[dict]) -> str: ...


class LlmStopped(Exception):
    """The upstream refused (balance / config / network): stop at once, keep the progress."""

    def __init__(self, status: int = 0, kind: str = ""):
        super().__init__(f"{kind or 'http'} {status}")
        self.status, self.kind = status, kind


SYSTEM_PROMPT = (
    "You write short English dictionary definitions for a learner's word list (CEFR A2-B1 vocabulary). "
    "For each word and each part of speech listed, write exactly one definition of at most 12 words that uses "
    "simple common words and does not repeat the headword. Part-of-speech codes: n noun, v verb, a adjective, "
    "r adverb, prep preposition, pron pronoun or determiner, conj conjunction, art article, num numeral, "
    "aux auxiliary or modal verb, int interjection. Reply with JSON only, no prose and no code fences: "
    '[{"word": "...", "defs": [{"pos": "...", "text": "..."}]}]. Keep the word and pos values exactly as given.')


def llm_candidates(gaps: list[Gap], done: set[str]) -> list[Gap]:
    """Gaps worth a model call: everything except proper nouns and abbreviations, not yet filled, with a known POS."""
    return [g for g in gaps if g.category not in ("proper", "abbr") and g.word not in done and "-" not in g.pos]


def make_batches(gaps: list[Gap], size: int = LLM_BATCH) -> list[list[Gap]]:
    return [gaps[i:i + size] for i in range(0, len(gaps), size)]


def build_messages(batch: list[Gap]) -> list[dict]:
    payload = json.dumps([{"word": g.word, "pos": list(g.pos)} for g in batch], ensure_ascii=False)
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": payload}]


_FENCE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.S)


def parse_reply(text: str, batch: list[Gap]) -> dict[str, list[dict]]:
    """Strict: a JSON array (one optional fenced block tolerated). Returns only fully valid words: requested word,
    exactly one def per requested POS, no extra POS, valid text. Anything else is dropped (it stays in the queue)."""
    body = (text or "").strip()
    fenced = _FENCE.match(body)
    try:
        rows = json.loads(fenced.group(1) if fenced else body)
    except ValueError:
        return {}
    if not isinstance(rows, list):
        return {}
    asked = {g.word: g.pos for g in batch}
    out: dict[str, list[dict]] = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("word") not in asked or row["word"] in out:
            continue
        defs = row.get("defs")
        if not isinstance(defs, list) or len(defs) != len(asked[row["word"]]):
            continue
        good, seen = [], set()
        for d in defs:
            if not isinstance(d, dict) or d.get("pos") not in asked[row["word"]] or d["pos"] in seen:
                break
            if validate_def(d["pos"], d.get("text"), "llm"):
                break
            seen.add(d["pos"])
            good.append({"pos": d["pos"], "text": d["text"], "src": "llm"})
        else:
            out[row["word"]] = sorted(good, key=lambda d: asked[row["word"]].index(d["pos"]))
    return out


def read_llm_rows(path: Path) -> dict[str, list[dict]]:
    rows: dict[str, list[dict]] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                row = json.loads(line)
                rows[row["word"]] = row["defs"]
    return rows


def write_llm_rows(path: Path, rows: dict[str, list[dict]]) -> None:
    write_bytes(path, "".join(dump_line({"word": w, "defs": rows[w]}) + "\n" for w in sorted(rows)).encode("utf-8"))


async def run_fill(client: LlmClient, gaps: list[Gap], out_path: Path, *, size: int = LLM_BATCH,
                   max_batches: int | None = None) -> dict:
    """Resumable: words already in `out_path` are skipped, the file is rewritten (sorted) after every batch.
    LlmStopped propagates after the progress is saved. A batch whose reply is unusable is counted and skipped."""
    rows = read_llm_rows(out_path)
    todo = llm_candidates(gaps, set(rows))
    report = {"candidates": len(todo), "batches": 0, "filled": 0, "rejected_words": 0, "bad_batches": 0}
    for batch in make_batches(todo, size):
        if max_batches is not None and report["batches"] >= max_batches:
            break
        report["batches"] += 1
        reply = await client.complete(build_messages(batch))  # may raise LlmStopped
        good = parse_reply(reply, batch)
        if not good:
            report["bad_batches"] += 1
        report["filled"] += len(good)
        report["rejected_words"] += len(batch) - len(good)
        rows.update(good)
        write_llm_rows(out_path, rows)
    return report


def spot_check(llm_path: Path, pct: int = SPOT_CHECK_PCT, seed: int = 20261012) -> list[tuple[str, str, str]]:
    """Deterministic ~pct% sample of (word, pos, text) for the human review."""
    flat = [(w, d["pos"], d["text"]) for w, defs in sorted(read_llm_rows(llm_path).items()) for d in defs]
    if not flat:
        return []
    return sorted(random.Random(seed).sample(flat, max(1, round(len(flat) * pct / 100))))


class RealLlm:
    """Dev-machine client through the server's own LLM provider settings (server/.env)."""

    def __init__(self):
        import httpx
        from app.core.config import Settings
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
        self._settings = Settings()

    async def complete(self, messages: list[dict]) -> str:
        from app.providers import llm
        try:
            return await llm.complete(self._http, self._settings, messages, model=self._settings.default_llm_model,
                                      max_tokens=4000, temperature=0.2, timeout=120.0)
        except llm.LlmUnavailable as e:
            raise LlmStopped(e.status, e.kind) from None

    async def aclose(self) -> None:
        await self._http.aclose()
