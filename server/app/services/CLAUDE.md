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
- `identities.py` – login sessions (`revoke_sessions`, `issue_token`, `change_password`) and email identities: `normalize_email` / `identity_key` (R-F1), `subject_hmac` (keyed HMAC, pepper passed in), `encrypt_email` / `decrypt_email`, `mask_email`, `email_ready` (pepper + encryption key + backend), `find_user_by_email`, `bind_email` / `clear_email` (no commit); never logs, errors never carry an address
- `email_domains.py` – `domain_allowed(settings, email)`: any / allowlist / blocklist with built-in tables
- `verification.py` – email codes: `issue` / `hidden_issue` / `verify` (HMAC-stored, purpose + target bound, cooldown, per-target cap, atomic global daily claim `claim_global_quota`, attempts claimed in separate transactions via the passed `async_sessionmaker`); `VerificationError(kind, retry_after)`; never logs
- `mailer.py` – `Mailer` (`app.state.mailer`): `enqueue(kind, to, code=, lang=)` returns at once, sends in a background task (`pending` set, waited by `tests/background.py`), templates in zh-CN / en, failures counted (`failures`, log `email send failed code=…`), `metering.record("email", …)` status only; settings and sender come from injected callables
- `email_codes.py` – `request_code(...)`: the orchestration behind `POST /api/email/code` (same steps for registered and unknown addresses; hidden rows, notices, quota); `request_bound_code(...)`: the signed-in `bind` / `change_email` twin (an address another account owns gets a hidden row + notice); takes the mailer as a parameter
- `email_accounts.py` – the flows a verified code unlocks, each ending in ONE commit: `register_with_email` (code -> invite use -> user + identity + verified flag + token), `reset_password` (reset code -> new hash + every token revoked), `bind_with_code` (bind / change_email code issued to this user -> identity replaced); every code failure is the same `VerificationError("invalid")`, also when the address was taken in a race; never logs

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
