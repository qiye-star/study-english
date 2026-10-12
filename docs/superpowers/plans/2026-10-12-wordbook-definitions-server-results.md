# Wordbook English definitions: real build results (lane Z2/Z3)

Measured on 2026-10-12 with `scripts/wordbook_definitions.py` (script_version 1) on the real inputs (OEWN 2025 index.sense zip sha256 `38b16326...`, ECDICT 1.0.28 zip sha256 `ea01f76a...`, books manifest `4b80d2bc...`). `verify` printed `ok`; `check` printed `ok`; two builds produced byte-identical `definitions.jsonl`, `missing.txt`, `SOURCE.json`.

| Item | Plan (written) | Measured |
|---|---|---|
| keys wanted | 14,615 | 14,615 |
| words with a definition | 14,019 | 14,021 |
| words with OEWN | 13,979 | 13,979 |
| defs | 29,158 | 29,160 |
| pairs oewn / hand / llm | 17,837 / 116 / 0 | 17,837 / 118 / 0 |
| partial_open_pos | 1,320 | 1,320 |
| gap rows | 757 | 755 |
| gap categories | function 229, proper 105, abbr 14, compound 23, pos_mismatch 45, other 341 | function 227, proper 105, abbr 14, compound 23, pos_mismatch 45, other 341 |
| definitions.jsonl size | ~2.6 MB | 2,653,260 bytes |

Why the differences: the committed hand file (lane D) has 104 words instead of 103 and, with the `an` entry added here (Ruling Z-1), 105; each hand pair removes one function gap. LLM candidates (function + compound + pos_mismatch + other) = 227 + 23 + 45 + 341 = 636 rows (before dropping rows without a POS).

## Spot check (seed 12, 30 words + the named words)
28/30 acceptable. Weak picks, accepted by design: `grass` n2 "a police informer", `confident` a2 "persuaded of". Named words: `abandon` v "forsake, leave behind"; `stamp`, `counter`, `sow`, `sketch` fine; `in`/`it`/`a`/`an`/`the`/`against`/`although` have `hand` lines for their closed POS. Proper nouns (`afghanistan`, `africa`, `alaska`, `shanghai` ...) have no definition and sit in `missing.txt` as `proper`. Not ideal: `in` and `a` also get WordNet noun lines (indium / inch, vitamin A / nucleotide) because one book types them `n` (`in`: "those in power; a way in"; `a`: "the letter A"). The strict build only forbids WordNet for closed POS, and the book really lists `n`.

## Rulings
- **Z-1** `an` is typed `indefinite article` by one book, which maps to `art`; lane D had left it out, so the build listed it as a function gap. Added a hand entry (`art`, "used instead of a before a vowel sound", 8 words) in its own commit.
- **Z-2** The `in`/`a` noun lines are left as built: fixing them needs either a hand override of an open POS (the hand-file tests allow closed POS only) or a script rule; weak but harmless, they follow the book. Candidate for the LLM-fill / a later hand-override rule.
- **Z-3** The loader test in `tests/test_wordbook_definitions_data.py` uses `pytest.importorskip("app.wordbook.definitions")` so it is skipped until lane R/P has merged (then it runs unchanged).
