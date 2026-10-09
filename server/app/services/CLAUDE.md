# app/services/

Domain logic shared by routers and realtime calls; framework-light, mostly pure functions.

## What lives here
- `assessment_store.py` – recording quota check + save (file + row) for assessments
- `recordings.py` – recording file paths under `DATA_DIR`, write/delete, per-user usage
- `chat_recordings.py` – drop assessment rows (unlink messages), remove files after commit,
  reclaim orphaned source=chat recordings
- `pronunciation.py` – iFlytek ISE request limits and language -> engine entry (`_ise_entry`)
- `uploads.py` – size-limited body read + buffered multipart parsing
- `grammar.py` – grammar-check prompt rules, request building, output normalization
- `prompts.py` – admin-versioned prompts (spec admin v2 §11): `PROMPTS` registry, `validate_prompt`,
  `prompt_cache(app)` (published versions; refreshed on `config_revisions['prompts']`), `apply_grammar`
  (a published `grammar.rules` sets `app.state.grammar_rules` + `grammar_rules_pinned`; it replaces only the
  rules, never `GRAMMAR_OUTPUT_CONTRACT`)
- `stats.py` – learning-progress aggregation (streaks, scores, weak words)
- `vocabulary.py` – word normalization and Leitner-box review scheduling
- `provider_clients.py` – FastAPI getters caching `AzureSpeech` / `XfyunIse` on `app.state`
- `usage.py` – persistent daily counters (`consume`, `remaining`, `refund`) for rank and rooms

## Allowed dependencies
`app.core`, `app.models`, `app.providers`. Never speech/realtime/rank/rooms/routers (enforced by
`tests/test_architecture.py`). If a router helper is needed by realtime, move it here.

## Entry points
`save_assessment`, `check_quota`, `cleanup_orphan_chat_recordings`, `normalize_grammar`,
`aggregate`, `next_review`, `get_azure`, `get_xfyun`, `prompt_cache`, `validate_prompt`.

## Tests
`uv run pytest -q tests/test_assessment_store.py tests/test_chat_orphan_cleanup.py tests/test_grammar_rules.py tests/test_prompts.py tests/test_stats.py tests/test_vocabulary_rules.py`

## Pitfalls
- Commit DB rows first, delete files after; file removal must never raise after a commit.
- Never log recording paths, user text, prompts or keys (prompt versions: key + version only).
- Tests override `get_xfyun` via `app.dependency_overrides`: keep it importable from here.
