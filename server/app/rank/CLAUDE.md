# app/rank/

Rank ladder (青铜…王者), RP sync from existing tables, stage tasks, promotion matches, achievements, seasons.
Spec: `docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md` §2–4. Off unless `RANK_ENABLED`.

## What lives here
- `tiers.py` – tier table, division math, seasons (pure)
- `points.py` – RP rules, daily cap, stage tasks (pure)
- `ledger.py` – incremental RP sync into `xp_events`, profile state, promotion status
- `achievements.py` – catalogue, snapshot queries, unlocks
- `scenarios.json` + `scenarios.py` – promotion-match scenarios
- `grading.py` – examiner/judge prompts, judge parsing, composite score, gates (pure)
- `match.py` – promotion-match orchestration with injected transcribe/assess/LLM

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`. Never `rooms`, `realtime`,
`admin` or `routers` (enforced by `tests/test_architecture.py`). Endpoints: `app/routers/rank.py`.

## Tests
`uv run pytest -q tests/test_rank_*.py`

## Pitfalls
- Never log transcripts, prompts, judge output or user text; log kinds, ids and numbers.
- Never store match audio. Sync must stay idempotent (`uq_xp_events_user_kind_ref`).
- Numbers come from the spec; change the spec first.
