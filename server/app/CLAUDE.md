# server/app/

The FastAPI application package. Layered; each layer may only import the ones below it.

## Layout
| Package | Holds |
|---|---|
| `core/` | settings + settings registry, runtime overrides hub (`runtime_settings`), secret box, DB engine, FastAPI deps (auth), per-user quotas, metering, maintenance middleware, log ring buffer, errors, logging, security, limits, timing |
| `models.py` | SQLAlchemy ORM schema (peer of core; imports only `core`) |
| `providers/` | vendor clients: Volcengine, Azure Speech, iFlytek (xfyun) |
| `speech/` | ASR/STT: buffered + streaming recognizers, realtime recognizer choice, sentence split |
| `services/` | domain logic: assessments, recordings, uploads, grammar, stats, vocabulary, invite codes, versioned prompts (`prompts.py`) |
| `realtime/` | realtime call protocol, session state machine, provider wiring, tickets |
| `rank/` | rank ladder, RP sync, promotion matches, achievements, versioned rules (`rules.py`, `rules_store.py`) |
| `rooms/` | practice rooms: codes, hub, assistant lane (admin-versioned templates), WS connection; v2 settings/scenarios, voice messages (`audio`, `voice_store`, `voice`), learning summary (`summary`, `summary_store`) |
| `admin/` | admin console (read-write since v2): cookie sessions, roles, CSRF, TOTP/step-up, hash-chained audit, recovery CLI, settings service, doctor/probes, user/room moderation, rank rules/ops, usage, announcements/maintenance, backups, prompts; v1 cross-user queries |
| `routers/` | HTTP/WS endpoints (one `router` per module) |
| `main.py` | `create_app()` – wires state, middleware and routers |
| `static_config/` | JSON config snapshots served by `/api/config/{key}` |

## Allowed dependencies (enforced by `tests/test_architecture.py`)
- core -> models only; models -> core
- providers -> core (and no FastAPI/Starlette)
- speech, services -> core, models, providers
- realtime -> core, models, providers, speech, services
- rank, rooms -> core, models, providers, speech, services; never each other or realtime
- admin -> core, models, providers, speech, services, realtime, rank, rooms; only routers and `main.py` import admin
- routers -> anything above (incl. rank, rooms); only `main.py` (and other routers) import routers
- Lazy/function-level imports count too. A new top-level module fails the test: pick a package.

## Runtime settings (admin v2)
`app.state.base_settings` = env only; `app.state.settings` = env + DB overrides (`setting_overrides`), swapped by
`SettingsHub.publish` (listeners push hot values into long-lived objects). Read settings per request
(`get_settings` / `app.state.settings`), never cache them at import or startup. Every settings write goes through
`admin/settings_service.save` (maintenance included). Multi-process sync: `config_revisions` polled every 5 s.

## Entry point
`app.main:create_app` (factory). Router order in `create_app` matters: `stubs` (catch-all
writes) must follow real APIs, `admin_web` (/admin) must precede `web`, and `web` (SPA fallback)
must be last.

## Tests
`cd server && uv run pytest -q`

## Pitfalls
- Absolute imports only (`from app.core.config import Settings`).
- Logger names follow `__name__`, except the pinned `app.timing` and
  `app.asr_stream.websockets` / `app.asr_realtime.websockets` channels; keep those strings.
- Never log keys, tickets, transcripts or user text; never commit `.env`.
- Migrations: `alembic/versions/` is linear (head `0011`); `tests/test_migrations.py::test_models_match_migrations`
  must stay green; every migration needs a SQLite (batch) + Postgres-safe path and a round-trip test.
- Room messages are kept forever (R-6 + owner ruling): nothing outside the M2 retention purge deletes `RoomMessage`;
  deleting a user never deletes rooms (`rooms.owner_id` nullable, `ON DELETE SET NULL`).
