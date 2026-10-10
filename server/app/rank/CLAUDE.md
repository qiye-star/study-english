# app/rank/

Rank ladder (青铜…王者), RP sync from existing tables, stage tasks, promotion matches, achievements, seasons.
Spec: `docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md` §2–4. Off unless `RANK_ENABLED`.

## What lives here
- `tiers.py` – tier table, division math, seasons (pure)
- `points.py` – RP rules, daily cap, stage tasks (pure)
- `ledger.py` – incremental RP sync into `xp_events`, profile state, promotion status; also reads `wordbook_events`
  through `app.models.WordbookEvent` (learn → `word_learned` ref `wl:<id>`, spell_set → `spelling_set` ref `ws:<id>`,
  both capped). Never import `app.wordbook` (architecture test)
- `achievements.py` – catalogue, snapshot queries, unlocks
- `scenarios.json` + `scenarios.py` – promotion-match scenarios
- `grading.py` – examiner/judge prompts, judge parsing, composite score, gates (pure)
- `match.py` – promotion-match orchestration with injected transcribe/assess/LLM
- `rules.py` – admin-publishable `RankRules` (pydantic, frozen), `DEFAULT_RULES` (= the constants above, pinned by
  `tests/test_rank_rules.py`), `rules_from_settings` (v0), `validate_rules`, JSON round trip
- `rules_store.py` – `rank_rules(app)` cache: `current()` (published version or v0), `for_version(n)` (LRU 8);
  invalidated through `on_revision(app, "rank_rules", ...)`. Draft/publish lives in `app/admin/rank_rules_admin.py`

## Rules threading (admin v2)
- Every rank function takes keyword-only `rules=None`; `None` = the built-in constants + Settings (exactly v0).
  `tiers/points/grading/scenarios` read `rules` by duck typing and never import `rules.py` (cycle).
- `routers/rank.py` passes the published rules (or `None` for v0) to new work; a match is pinned to
  `promotion_matches.rules_version` and later steps use that version's rules.
- Prompts are `str.format` templates (`grading.EXAMINER_TEMPLATE` / `JUDGE_TEMPLATE`); the legacy output is pinned by
  `tests/fixtures/rank_prompts_legacy.json`. Admin templates are validated (exact fields, no `!r`/format spec, `<learner>`).
- Admin profile edits hold `ledger.user_lock(user_id)` across their commit; admin void/regrade check `match.is_busy`.

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`. Never `rooms`, `realtime`,
`admin` or `routers` (enforced by `tests/test_architecture.py`). Endpoints: `app/routers/rank.py`.

## Tests
`uv run pytest -q tests/test_rank_*.py tests/test_admin_rank*.py`

## Pitfalls
- Never log transcripts, prompts, judge output or user text; log kinds, ids and numbers.
- Never store match audio. Sync must stay idempotent (`uq_xp_events_user_kind_ref`).
- Numbers come from the spec; change the spec first.
