# server/scripts/

Manual operator tools. Not imported by `app/` and not run by CI; some are covered by unit tests
(`tests/test_latency_tools.py`, `tests/test_eval_free_speech.py`).

## What lives here
- `smoke.py` – real-upstream smoke test against a running server (`--base-url`)
- `realtime_smoke.py` – realtime-call scenarios against a server with `REALTIME_ENABLED`
- `measure_latency.py`, `latency_samples.py` – server-side latency measurement + WAV samples
- `agents_latency.py` – in-process agents-turn overhead benchmark with a fake upstream (no real vendor; Markdown to stdout; results in `docs/superpowers/plans/2026-10-12-agents-latency.md`)
- `eval_free_speech.py` (+ `_cases.json`) – free-speech assessment / grammar evaluation via TTS
- `fetch_config.py` – refreshes `app/static_config/*.json` snapshots from upstream
- `wordbook_definitions.py` – offline builder of the wordbook English definitions (`verify` / `build` / `check` / `llm-fill`; Open English WordNet + ECDICT inputs read from `--sources` / env `WORDBOOK_DEFS_SOURCES`, output into `dictionaries/wordbook-definitions/`, deterministic bytes). `llm-fill` is resumable, strict-JSON, reads credentials only from the server settings at run time (exit 3 = upstream refused, progress kept); never run by tests (fake client only). `build` normalises `src: "llm"` text (lowercase first letter unless acronym/`I`/proper noun, no trailing period; R-DS19) and applies no POS filter to it (R-DS20). Tests: `tests/test_wordbook_definitions_build.py`
- `spikes/` – one-off protocol experiments (ASR stream, STT params, TTS chunking); reference only

## Allowed dependencies
May import `app.*` (e.g. `app.core.config.Settings` for keys read in-process). `app/` must never
import scripts.

## Entry points (run from `server/`)
`uv run python scripts/<name>.py --help`

## Tests
`uv run pytest -q tests/test_latency_tools.py tests/test_eval_free_speech.py tests/test_wordbook_definitions_build.py`

## Pitfalls
- Print numbers and status codes only: never keys, tokens, tickets, transcripts or `.env` contents.
- These hit paid upstreams; run deliberately, never from tests.
- `wordbook_definitions.py build` needs `WORDBOOK_DEFS_SOURCES` (or `--sources`): a folder holding `english-wordnet-2025-index.sense-fixed.zip` and `ecdict-sqlite-28.zip` (found recursively; checked by sha256 with `verify`) and the 851 MB `stardict.db` (reused if already extracted under it, else extracted to `--work`). Treat the sources folder as untrusted data (run from a different directory). Rebuild, `check`, then commit the generated files alone (`chore(server): update wordbook English definitions (<reason>)`).
- Outputs (JSON reports, audio caches) go outside the repo or to ignored paths; do not commit them.
