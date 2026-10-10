# app/admin/

Admin console business logic behind `/api/admin/*` (routers `admin.py` v1 read-only, `admin_auth.py`,
`admin_*.py` v2). **No longer read-only:** every write goes through `perms.require(...)` (+ step-up for dangerous
actions) and writes an audit row in the same transaction. Spec: `docs/superpowers/specs/2026-10-09-admin-console-v2-design.md`.
Disabled (404 everywhere) unless `ADMIN_USERNAME` and `ADMIN_PASSWORD` (>= 12 chars) are set, or when the
client IP is outside `ADMIN_IP_ALLOWLIST`.

## What lives here
- `perms.py` – `require_enabled` (+ IP allowlist), `current_admin` (cookie session, MFA, CSRF/Origin, denials audited
  as `auth.denied` via `deny`,
  `ADMIN_REQUIRE_TOTP` gate), `require(role)`, `require_step_up` / `require_operator_step_up` /
  `require_self_step_up`, `AdminContext`, `REQUIRED_ROLE_ATTR`
- `sessions.py` – DB sessions (`admin_sessions`): token/CSRF stored as SHA-256 only, idle + absolute
  expiry, `__Host-enjoy_admin` (or `enjoy_admin` when `ADMIN_COOKIE_SECURE=false`) HttpOnly SameSite=Strict
- `accounts.py` – env emergency superadmin + DB accounts (argon2), `authenticate`, `check_password`,
  `totp_secret`, recovery codes
- `audit.py` – append-only `admin_audit` with a SHA-256 hash chain: `record`, `verify`, `listing`,
  `redact_setting`, `Actor`, `CLI_ACTOR`
- `lockout.py` – per (username, IP) lockout doubling to 24 h; per-username global count only alarms
- `totp.py` – RFC 6238 TOTP (stdlib) and recovery codes
- `recover.py` – `python -m app.admin.recover list-overrides|clear-overrides|unlock|reset-totp|revoke-sessions|rotate-key`
- `auth.py` – env credential comparison (`credentials_match`)
- `settings_service.py` – runtime settings: `list_settings`, `save` (danger/step-up/typed confirm, key-pair guard on
  every key-bearing endpoint: `url` settings and `HOST_FORMING` ones such as `azure_speech_region`, compared as
  (scheme, host, port),
  revisions, publish through the hub; the **only** settings write path, also used by `announcements.set_maintenance`
  and import/revert), `revert`, export/import; the six `managed_by="rank_rules"` keys are read-only (409
  `Managed by rank rules`) once a rank rules version is published
- `doctor.py` – config doctor findings (`diagnose(settings, Facts)` pure + `gather_facts`; includes
  `missing_prices` from `usage.missing_prices`, `invite_without_codes`, `wordbook_data_missing`, `wordbook_ai_unavailable`)
- `probes.py` – "test connection" per upstream (`UPSTREAMS`), SSRF-guarded (one DNS lookup, every address must be
  `is_global`, the connection is pinned to it; no HTTP or WebSocket redirects), returns only `{ok, status, ms, code}`.
  Probing unsaved values that would send the saved key to a new endpoint needs step-up + `confirm_pairs`
- `rank_rules_admin.py` / `rank_ops.py` / `rank_sim.py` – rank rules drafts/validate/publish (bumps
  `config_revisions['rank_rules']`), per-user and site-wide rank operations (reset with undo), impact simulation.
  Resets, point cuts and undo void the affected users' open matches (409 `Match is busy` mid-request); bulk ops hold
  every affected user's `ledger.user_lock` across the commit; batch ids are `all-…` (site-wide, the overview's undo)
  or `usr-…`; undo skips users reset again later; snapshots are purged after `UNDO_DAYS` by `purge_expired`
- `prompts_admin.py` – prompt drafts/publish/test run (bodies never logged or audited); room templates render through
  `rooms.assistant.render_test`, same as live
- `service.py` – v1 cross-user read queries (overview, users with `status`/`sort`, conversations, assessments, ...)
- `users_admin.py` – disable/enable, revoke tokens, reset password (temp password returned once, never logged),
  delete user (explicit deletes: SQLite has no FK cascade; rank snapshots deleted, metering rows anonymised to the
  system user; owned rooms pass to the earliest other member, a room
  nobody else joined is kept closed with `owner_id = NULL` — rooms and room messages are never deleted),
  per-user quota overrides (`quota.set|clear`; above `operator_ceiling` = 10x the site value only superadmin + step-up)
- `invites.py` – multi-use invite codes (SHA-256 only; plain code returned once); consumption in `services/invites.py`
- `rooms_admin.py` – room/report queries and `report.resolve`; live actions (close/kick/hide/AI mute) are in
  `routers/admin_rooms.py`
- `wordbook_admin.py` – word books (spec 2026-10-10-wordbook §9): `overview` (enabled books: file bytes + sha256 vs
  `SOURCE.json`, cached by size/mtime; index state; learners / 7-day / learned / mastered / open reports; AI calls today),
  `reload` (`wordbook.reload`), `reports` (open reports grouped per sentence, text read from the dictionary),
  `resolve` hide/dismiss (`wordbook.sentence.hide` / `wordbook.report.dismiss`; hide refreshes the live hidden set).
  Never returns user input, explanation bodies or absolute paths
- `usage.py` – usage/estimated cost from `upstream_calls` (+ older `usage_daily`): `parse_prices`, `estimate`,
  `summary`, `top_users`, `health`, `missing_prices` (for the config doctor)
- `announcements.py` – announcements (create/update/archive, public `active`) and `set_maintenance` (a thin wrapper
  over `settings_service.save(action="maintenance.set")`; turning it on = step-up + reason + typed `MAINTENANCE_MODE`)
- `system.py` – `status(app, session)` for `GET /api/admin/system` (version, DB/alembic, disk, tasks, settings;
  its findings are computed locally, separate from `doctor.py`)
- `housekeeping.py` – orphan recording scan/delete (token-guarded rescan), audit purge with anchor, `purge_expired`
- `backups.py` – SQLite `VACUUM INTO` backups, prune, signed one-time download links, `daily_loop` (backup at
  `BACKUP_HOUR_UTC` + daily `purge_expired`; registered in `app.state.background_tasks["backups"]`)

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`, `app.realtime`, `app.rank`, `app.rooms`, `app.wordbook`.
Only `app/routers/` and `app/main.py` may import `app.admin` (enforced by `tests/test_architecture.py`).
Never import routers from here (room runtime lives in `routers/admin_rooms.py` via `app.routers.rooms.runtime`).

## Rules for every write
- Endpoint declares its minimum role (`Depends(require(...))`); `tests/test_admin_routes_guarded.py` walks the
  route table. Non-GET requests pass CSRF in `current_admin`. Dangerous actions use a step-up dependency + `reason`.
- Write the audit row with `audit.record(session, ctx.actor, "area.verb", ...)` in the same transaction.
- Secrets appear only as `{"set", "source", "fp"}`; tests scan responses with `tests/admin_helpers.assert_no_secrets`.

## Tests
`uv run pytest -q tests/test_admin_*.py tests/test_quotas*.py tests/test_architecture.py tests/test_usage*.py
tests/test_announcements.py tests/test_system_status.py tests/test_housekeeping.py tests/test_backups.py
tests/test_invites.py tests/test_invite_mode_db_codes.py tests/test_prompts*.py tests/test_rank_rules*.py`
(helpers: `tests/admin_helpers.py` — `ADMIN_ENABLED`, `PASSWORD`, `login_as(app, client, role)`, `assert_no_secrets`)

## Pitfalls
- Never log or audit passwords, TOTP/recovery codes, tokens, CSRF, secrets, user text or prompt bodies.
- `ADMIN_SESSION_SECRET` empty => generated once and stored in `app_secrets` (`sessions.ensure_secret`, loaded on the
  first admin request), so CSRF tokens and env fingerprints survive restarts and match across workers; changing the
  env value revokes every admin session. Read it via `await sessions.ensure_secret(app)`, never `app.state` directly.
- `admin_web` must be registered before `web` (SPA fallback) in `create_app`.
- The audit chain is serialised through the one-row `audit_head` (DB write/row lock held until the caller commits):
  commit promptly after `audit.record`, never await upstream calls between them. `verify` also needs the oldest row
  to start at GENESIS or be named by an `audit.purge` anchor.
