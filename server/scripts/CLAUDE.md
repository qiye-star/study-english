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
- `spikes/` – one-off protocol experiments (ASR stream, STT params, TTS chunking); reference only

## Allowed dependencies
May import `app.*` (e.g. `app.core.config.Settings` for keys read in-process). `app/` must never
import scripts.

## Entry points (run from `server/`)
`uv run python scripts/<name>.py --help`

## Tests
`uv run pytest -q tests/test_latency_tools.py tests/test_eval_free_speech.py`

## Pitfalls
- Print numbers and status codes only: never keys, tokens, tickets, transcripts or `.env` contents.
- These hit paid upstreams; run deliberately, never from tests.
- Outputs (JSON reports, audio caches) go outside the repo or to ignored paths; do not commit them.
