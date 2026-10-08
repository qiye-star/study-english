# server/app/

The FastAPI application package. Layered; each layer may only import the ones below it.

## Layout
| Package | Holds |
|---|---|
| `core/` | settings, DB engine, FastAPI deps (auth), errors, logging, security, limits, timing |
| `models.py` | SQLAlchemy ORM schema (peer of core; imports only `core`) |
| `providers/` | vendor clients: Volcengine, Azure Speech, iFlytek (xfyun) |
| `speech/` | ASR/STT: buffered + streaming recognizers, realtime recognizer choice, sentence split |
| `services/` | domain logic: assessments, recordings, uploads, grammar, stats, vocabulary |
| `realtime/` | realtime call protocol, session state machine, provider wiring, tickets |
| `routers/` | HTTP/WS endpoints (one `router` per module) |
| `main.py` | `create_app()` – wires state, middleware and routers |
| `static_config/` | JSON config snapshots served by `/api/config/{key}` |

## Allowed dependencies (enforced by `tests/test_architecture.py`)
- core -> models only; models -> core
- providers -> core (and no FastAPI/Starlette)
- speech, services -> core, models, providers
- realtime -> core, models, providers, speech, services
- routers -> anything above; only `main.py` (and other routers) import routers
- Lazy/function-level imports count too. A new top-level module fails the test: pick a package.

## Entry point
`app.main:create_app` (factory). Router order in `create_app` matters: `stubs` (catch-all
writes) must follow real APIs and `web` (SPA fallback) must be last.

## Tests
`cd server && uv run pytest -q`

## Pitfalls
- Absolute imports only (`from app.core.config import Settings`).
- Logger names follow `__name__`, except the pinned `app.timing` and
  `app.asr_stream.websockets` / `app.asr_realtime.websockets` channels; keep those strings.
- Never log keys, tickets, transcripts or user text; never commit `.env`.
