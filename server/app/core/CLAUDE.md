# app/core/

Foundation layer used by every other package.

## What lives here
- `config.py` – `Settings` (pydantic-settings, env/.env) plus pure ASR config predicates
  (`effective_realtime_asr`, `realtime_asr_configured`, ...) that `Settings.realtime_available` needs
- `db.py` – async engine factory and `Base`
- `deps.py` – FastAPI dependencies: `get_settings`, `get_session`, `current_user`, `limited_user`
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
- `metering.py` – metering context (`bind_user`, `feature_scope`); the queue/recorder arrives with lane ops (E1)

## Allowed dependencies
Standard library, third-party packages, `app.core.*` and `app.models` (deps needs `User`).
Nothing from providers/speech/services/realtime/routers – not even lazily.

## Entry points
`Settings`, `make_engine`, `install_error_handlers`, `configure_logging`, `get_*` deps,
`runtime_settings.SettingsHub` (`app.state.settings_hub`; `app.state.base_settings` is the env-only base).

## Tests
`uv run pytest -q tests/test_config.py tests/test_security.py tests/test_logging_setup.py tests/test_timing.py tests/test_ratelimit.py tests/test_limits.py tests/test_settings_registry.py tests/test_runtime_settings.py tests/test_hot_reload.py tests/test_secretbox.py tests/test_quotas.py`

## Pitfalls
- Settings field names are the env contract (`.env.example`, docker-compose); renaming breaks deploys.
- A new `Settings` field needs a `SettingSpec` in `settings_registry.py` (test enforced). A "hot" key that some
  object baked in at startup needs a hub listener (`main.register_core_listeners` or a lane's own `subscribe`).
- Read settings per request (`Depends(get_settings)` / `request.app.state.settings`); never cache a `Settings`
  object in a module global — overrides replace `app.state.settings` at runtime.
- Ticket redaction in `logging_setup` is security-relevant: keep its tests green.
- Never log or print settings values that hold keys.
