# app/wordbook/

背单词 (spec `docs/superpowers/specs/2026-10-10-wordbook-design.md`). Off unless `WORDBOOK_ENABLED`.

## What lives here
- `books.py` – the seven books, enabled-list parsing, data dir (pure)
- `textnorm.py` / `entry.py` – tokenizing, inflections, cleaning and merging raw lines into `WordCard` (pure)
- `index.py` – `BookIndex` + `DictionaryStore` (`dictionary(app)`): lazy per-book index, line reads, LRU, hidden sentences
- `grading.py` / `quiz.py` / `cloze.py` / `plan.py` – grading, question types and distractors, spelling sets, daily plan (pure)
- `store.py` – enrollments, learned words, events, counters (DB); `service.py` – endpoint orchestration; `explain.py` – AI "why"

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`. Imported only by `app/admin`, `app/routers`,
`app/main.py` (enforced by `tests/test_architecture.py`). Rank reads `wordbook_events` through `app.models`, never this package.

## Tests
`uv run pytest -q tests/test_wordbook_*.py tests/test_rank_wordbook.py tests/test_admin_wordbook.py`
Fixture book: `tests/fixtures/wordbook/mini.jsonl`; helpers `tests/wordbook_helpers.py`.

## Pitfalls
- Dictionary files are read-only and byte-exact; never write next to them. Build indexes off the event loop (`asyncio.to_thread`).
- Grading is deterministic and stateless (P-W2); never call an LLM to grade.
- Never log user answers, explanations or prompt bodies; log book id, word length, status codes.
- `app.core.config.WORDBOOK_BOOK_IDS` duplicates `books.BOOK_IDS` (core cannot import this layer); `tests/test_wordbook_books.py` keeps them equal.
