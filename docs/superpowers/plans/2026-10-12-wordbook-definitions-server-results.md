# Wordbook English definitions: real build results (lane Z2/Z3)

Measured on 2026-10-12 with `scripts/wordbook_definitions.py` (script_version 1) on the real inputs (OEWN 2025 index.sense zip sha256 `38b16326...`, ECDICT 1.0.28 zip sha256 `ea01f76a...`, books manifest `4b80d2bc...`). `verify` printed `ok`; `check` printed `ok`; two builds produced byte-identical `definitions.jsonl`, `missing.txt`, `SOURCE.json`.

| Item | Plan (written) | First build | Rebuild (script_version 2) |
|---|---|---|---|
| keys wanted | 14,615 | 14,615 | 14,615 |
| words with a definition | 14,019 | 14,021 | 14,021 |
| words with OEWN | 13,979 | 13,979 | 13,916 |
| defs | 29,158 | 29,160 | 28,943 |
| pairs oewn / hand / llm | 17,837 / 116 / 0 | 17,837 / 118 / 0 | 17,719 / 118 / 0 |
| partial_open_pos | 1,320 | 1,320 | 1,366 |
| usage_filtered_pairs | - | - | 42 |
| gap rows | 757 | 755 | 755 |
| gap categories | function 229, proper 105, abbr 14, compound 23, pos_mismatch 45, other 341 | function 227, proper 105, abbr 14, compound 23, pos_mismatch 45, other 341 | function 227, proper 105, abbr 14, compound 23, pos_mismatch 45, other 341 |
| definitions.jsonl size | ~2.6 MB | 2,653,260 bytes | 2,637,503 bytes |

Rebuild (R-DS17, R-DS18): `verify` printed `ok`; `check` printed `ok`; two builds were byte-identical (`definitions.jsonl`, `missing.txt`, `SOURCE.json`). Hand-entry words now have only `hand` lines (the 118 hand pairs; the 105 hand words lose their WordNet noun/verb lines, which also raises `partial_open_pos`). 42 (word, POS) pairs changed because a usage-labelled sense was dropped.

Why the first-build differences: the committed hand file (lane D) has 104 words instead of 103 and, with the `an` entry added here (Ruling Z-1), 105; each hand pair removes one function gap. LLM candidates (function + compound + pos_mismatch + other) = 227 + 23 + 45 + 341 = 636 rows (before dropping rows without a POS).

## Spot check (rebuild; seed 7, 20 random words + the named words)
Named words: `in` prep "inside or within a place, time, or state" (hand only, no indium); `a` art (hand only, no vitamin A); `an` art (hand); `abandon` v "forsake, leave behind" then "give up with the intent of never claiming again"; `stamp` n/v fine. The 20 random words (`gambling`, `comic`, `retrain`, `barrel`, `border`, `night`, `lane`, `duke` ...) read acceptably. Still weak, accepted: `grass` n2 "a police informer who implicates many people" and `confident` a2 "persuaded of" - their OEWN glosses carry no usage label of any kind (no leading label, no `;u` domain pointer), so the deterministic filter cannot and does not touch them. Proper nouns have no definition and sit in `missing.txt` as `proper`.

### Markers found in the OEWN 2025 data (first 71,864 noun synsets etc.)
- Leading parenthetical label in the gloss (101 synsets, e.g. `(slang) a self-aggrandizing action`, `(British informal) pork sausage`, `(archaic) lame persons collectively`, `(ethnic slur) offensive term for a Jew`, `(dated slang) a remarkable or excellent thing`): used, except hedged (`(usually informal)`, `(sometimes offensive)`) and `(euphemism)`.
- Leading phrase (128 glosses, e.g. `British slang for a swindle`, `slang for a jail`, `informal term for a destroyer`, `an archaic term for a parrot`, `derogatory term for a variation that is not genuine`): used.
- Usage-domain pointers `;u` (8,264; slang 91, colloquialism 295, disparagement 608, archaism 78, obscenity 48 ...): NOT used, too noisy (`insect`, `gorilla`, `toilet_bowl` under disparagement; `bite`, `Caterpillar` under slang; `forward` under dialect); `lex_filenum` is only the semantic class.

## Rulings
- **Z-1** `an` is typed `indefinite article` by one book, which maps to `art`; lane D had left it out, so the build listed it as a function gap. Added a hand entry (`art`, "used instead of a before a vowel sound", 8 words) in its own commit.
- **Z-2** (superseded by R-DS17) The `in`/`a` noun lines were first left as built; the rebuild fixes them with a script rule: a word with a hand entry gets no OEWN lines at all.
- **R-DS17** Hand entry wins entirely (see the plan). **R-DS18** Usage-labelled OEWN senses are dropped while the POS keeps another sense; markers are the two gloss forms listed above, `;u` pointers rejected (see the plan).
- **Z-3** The loader test in `tests/test_wordbook_definitions_data.py` uses `pytest.importorskip("app.wordbook.definitions")` so it is skipped until lane R/P has merged (then it runs unchanged).

## LLM merge (definitions-llm.jsonl, 620 words / 683 defs merged)
Measured after `build --sources D:	mp-ecdict` with the merge-time text normalisation (R-DS19); `verify` printed `ok`; `check` printed `ok`; two builds were byte-identical (`definitions.jsonl`, `missing.txt`, `SOURCE.json`).

| Item | Before (script_version 2, no llm) | After merge |
|---|---|---|
| keys wanted | 14,615 | 14,615 |
| words with a definition | 14,021 | 14,480 |
| words with oewn / hand / llm defs | 13,916 / 105 / 0 | 13,916 / 105 / 620 (459 llm-only) |
| defs (oewn / hand / llm) | 28,943 total (28,825 / 118 / 0) | 29,626 total (28,825 / 118 / 683) |
| pairs oewn / hand / llm | 17,719 / 118 / 0 | 17,719 / 118 / 683 |
| partial_open_pos | 1,366 | 1,395 |
| usage_filtered_pairs | 42 | 42 |
| gap rows | 755 | 135 |
| gap categories | function 227, proper 105, abbr 14, compound 23, pos_mismatch 45, other 341 | function 0, proper 105, abbr 14, compound 13, pos_mismatch 1, other 2 |
| definitions.jsonl size | 2,637,503 bytes | 2,697,348 bytes |
| missing.txt size | 17,404 bytes | 2,707 bytes |

Normalisation effect: of 683 llm texts none ends with a period; 9 start with a capital (proper-noun rule: `everest`, `forbes`, `gibraltar`, `gobi`, `hamlin`, `hohokam`, `hopewell`, `hyksos`, `prairies`).

### Spot check (llm merge; 30 random llm words, seed 5, plus named words)
30 random words read acceptably (`nucleic` "relating to acids in cells that carry genetic information", `timescale`, `imagist`, `belter`, `uncrumple`, `wearability`, `pointe`, `resume`, `eka`, `connecticut`, `ouch`, ...). Weak lines found, accepted (R-DS20, no deterministic rule separates them from good lines):
- `anybody` prep "used before a noun meaning any person" (the book types it `prep`); `another` prep "used before a different person or thing"; `all` prep "the whole of a period or amount"; `with` pron "used to ask which person goes together"; `dare` aux "used to ask if someone is brave enough"; `given` prep "when you consider something" (weak); `eka` and a few rare words are thin.
- Fine: `everyone` (pron "all people", n "all the people in a group"), `past` prep "later than a time", `across`, `aboard`.

### Rulings (LLM merge)
- **R-DS19** llm text is normalised in `build` (see the plan), the raw file stays as generated.
- **R-DS20** No POS filter: 683 llm lines, 0 with a POS outside the word's book POS set; wrong lines have book-typed POS (see the plan).
- **Z-4** `test_hand_written_function_words` now checks "no oewn line for a hand word" instead of "hand only": llm may fill a POS the hand file lacks (e.g. `all` prep).
