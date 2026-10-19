# app/core/

Foundation layer used by every other package.

## What lives here
- `config.py` – `Settings` (pydantic-settings, env/.env) plus pure ASR config predicates
  (`effective_realtime_asr`, `realtime_asr_configured`, ...) that `Settings.realtime_available` needs
- `db.py` – async engine factory and `Base`; patches SQLAlchemy's aiosqlite `_terminate_graceful_close` so cancelling a task mid-query cannot hang on a dead worker thread (`test_db_cancel.py`)
- `deps.py` – FastAPI dependencies, three tiers over one `_authenticate` (token lookup, disabled check, sliding renewal):
  `current_user` (default; 403 `email_binding_required` while binding is enforced and the user has no verified email),
  `current_user_unbound` (same authentication, no binding check; used only by the four endpoints that must work while binding
  is enforced: `GET /api/me`, `DELETE /api/sessions/current`, `POST /api/me/email/code`, `POST /api/me/email`), and
  `limited_user` (per-user rate limit on top of `current_user`); plus `get_settings`, `get_session`, `client_ip`, `auth_rate_limit`
- `account_policy.py` – `binding_state(settings, now)` -> `none` / `pending` / `enforced` and `binding_deadline(settings)`: pure, stdlib + `Settings` only (INDEX X33); `deps.py` calls it per request, never caches the answer
- `security.py` – password hashing, access tokens
- `errors.py` – JSON error handlers (`{"error": ...}`)
- `logging_setup.py` – `app` logger handler + `ticket=` redaction on uvicorn loggers
- `bodylimit.py`, `ratelimit.py` – request size and rate limits
- `timing.py` – `timing event=... k=v` lines (logger `app.timing`, numbers only)
- `upstream.py` – maps upstream 401/403 to HTTP 502 (HTTP error policy, hence core)
- `settings_registry.py` – one `SettingSpec` per `Settings` field (group, kind, apply, env_only, secret,
  danger, bounds, pair, managed_by); `SPECS`, `ENV_ONLY`, `SECRETS` (admin v2 §3.2)
- `runtime_settings.py` – env base + DB overrides: `coerce`, `compose`, `runtime_problems`, `SettingsHub`
  (prepare → atomic swap of `app.state.settings` → listeners), `reload_from_db`, `bump_revision`,
  `watch_revisions`/`on_revision` (5 s poll of `config_revisions`), `register_startup_hook`
- `secretbox.py` – Fernet `SecretBox` for stored secrets (`SETTINGS_ENCRYPTION_KEY`), keyed `fingerprint`
- `quotas.py` – per-user quota overrides: `quota_for`, `overrides_for`, `QUOTA_KEYS`
- `metering.py` – upstream call metering (admin v2 §8.1): `record(kind, provider, model, status, ms, units_in=,
  units_out=, unit=)` into the bounded in-memory `METER` (never raises; numbers only), `MeteringMiddleware`
  (feature by path), `bind_user` (called by `current_user`), `feature_scope`, `flush_loop` (5 s batch writes to
  `upstream_calls`, hourly `rollup_and_prune` into `usage_daily`); helpers `provider_of`, `audio_units`, `pcm_ms`
- `maintenance.py` – `MaintenanceMiddleware` (pure ASGI, reads `maintenance_mode` per request): read_only → 503 on
  `/api/**` writes, full → 503 on all `/api/**`; `/up`, `/api/admin`, `/api/announcements`, `POST /api/sessions`
  (read_only) pass; new WebSockets get close 1013 before accept
- `log_buffer.py` – in-memory ring buffer (2000) on the `app` and `uvicorn.error` loggers for the admin log viewer;
  `redact` (ticket/Bearer/key=…/JSON keys/current secret values via `set_secrets`); installed by `configure_logging`
- `learning_events.py` – learning event channel (learning-links spec §4; standard library only): frozen event
  dataclasses `WordAnswered` / `AssessmentFinished` (+ `WeakWord`) / `MessageSent`, `LearningBus` (bounded deque,
  single consumer `run()`, per-handler timeout, circuit breaker, counters, `drain()` for tests/shutdown) and the
  contextvar `bind(bus)` (called by `current_user`) / `publish(event)` (never raises; only after `commit()`)
- `rank_sources.py` – rank point source registry (learning-links spec §5.1; standard library only): `RankSource`,
  `register` (idempotent for an equal source; refuses `RESERVED_KINDS`, bad kinds, points outside 0–100),
  `registered`, `kinds`, `get`, `clear_for_tests`. Links register sources at startup; rank reads `LinkCredit`

## Allowed dependencies
Standard library, third-party packages, `app.core.*` and `app.models` (deps needs `User`).
Nothing from providers/speech/services/realtime/routers – not even lazily.
`learning_events.py` and `rank_sources.py` use the standard library only (enforced in `tests/test_architecture.py`).

## Entry points
`Settings`, `make_engine`, `install_error_handlers`, `configure_logging`, `get_*` deps,
`runtime_settings.SettingsHub` (`app.state.settings_hub`; `app.state.base_settings` is the env-only base).

## Tests
`uv run pytest -q tests/test_config.py tests/test_security.py tests/test_logging_setup.py tests/test_timing.py tests/test_ratelimit.py tests/test_limits.py tests/test_settings_registry.py tests/test_runtime_settings.py tests/test_hot_reload.py tests/test_secretbox.py tests/test_quotas.py tests/test_metering.py tests/test_metering_instrumentation.py tests/test_maintenance.py tests/test_log_buffer.py`
Binding gate: `uv run pytest -q tests/test_accounts_binding_gate.py`

## Pitfalls
- Settings field names are the env contract (`.env.example`, docker-compose); renaming breaks deploys.
- A new `Settings` field needs a `SettingSpec` in `settings_registry.py` (test enforced). A "hot" key that some
  object baked in at startup needs a hub listener (`main.register_core_listeners` or a lane's own `subscribe`).
- Read settings per request (`Depends(get_settings)` / `request.app.state.settings`); never cache a `Settings`
  object in a module global — overrides replace `app.state.settings` at runtime.
- Ticket redaction in `logging_setup` is security-relevant: keep its tests green.
- Never log or print settings values that hold keys.
- Every new upstream call needs a `metering.record(...)` at the call site (success and failure; status 0 = no
  response). Never pass text, prompts or URLs with query strings to it — `provider_of(base_url)` only.
- `learning_events.publish(...)` goes strictly after the publisher's `await session.commit()`; publishers never
  check switches or import `app.links`. The bus logs only link key, event class and exception class — never words,
  message text, exception messages or user ids. `MessageSent.text` stays in memory (`repr=False`).
