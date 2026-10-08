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

## Allowed dependencies
Standard library, third-party packages, `app.core.*` and `app.models` (deps needs `User`).
Nothing from providers/speech/services/realtime/routers – not even lazily.

## Entry points
`Settings`, `make_engine`, `install_error_handlers`, `configure_logging`, `get_*` deps.

## Tests
`uv run pytest -q tests/test_config.py tests/test_security.py tests/test_logging_setup.py tests/test_timing.py tests/test_ratelimit.py tests/test_limits.py`

## Pitfalls
- Settings field names are the env contract (`.env.example`, docker-compose); renaming breaks deploys.
- Ticket redaction in `logging_setup` is security-relevant: keep its tests green.
- Never log or print settings values that hold keys.
