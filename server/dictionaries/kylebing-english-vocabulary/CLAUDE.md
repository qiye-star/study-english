# kylebing-english-vocabulary/

KyleBing/english-vocabulary `full_line_jsonl/sentence/正序` (BSD-3-Clause, see `LICENSE` and repo-root `NOTICE`).

## What lives here
- `<id>.jsonl` for junior 初中, senior 高中, cet4 四级, cet6 六级, kaoyan 考研, toefl 托福, sat SAT: one JSON object per line
  `{"word","us","uk","translations":[{"translation","type"}],"phrases":[{"phrase","translation"}],"sentences":[{"sentence","translation"}]}`.
- `SOURCE.json` – upstream commit, upstream path, bytes, sha256, entries, unique words per book.

## Pitfalls
- Lines are not unique per word (each book concatenates 2–3 source lists); `app/wordbook/entry.py` merges them.
- Data quirks (dirty headwords, `(= …)` glosses, missing phonetics) are documented in the spec §2 and cleaned at read time.
