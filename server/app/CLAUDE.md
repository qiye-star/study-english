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
| `rooms/` | practice rooms (create/join/close/reopen): codes, hub, assistant lane (admin-versioned templates), WS connection; v2 settings/scenarios, voice messages (`audio`, `voice_store`, `voice`), learning summary (`summary`, `summary_store`) |
| `wordbook/` | 背单词:词典文件索引、题型与判分、学习编排、AI 讲解 (off unless `WORDBOOK_ENABLED`; see `wordbook/CLAUDE.md`) |
| `agents/` | 智能体共用核心:角色、用户设置、上下文来源注册表与并行预取、提示词拼装、过程事件、一次流式调用的编排、每日上限与回合幂等;`memory/`(A2)、`tutor/`(A3)子包 (off unless `AGENTS_ENABLED`; see `agents/CLAUDE.md`) |
| `links/` | 学习联动(顶层):订阅核心学习事件(`core/learning_events.py`),实现六个联动;只有 routers 与 `main.py` 导入 (off unless `LINKS_ENABLED`; see `links/CLAUDE.md`) |
| `library/` | 跟读库:上传 / 链接导入的音视频、处理流水线与进程内队列、字幕解析与分句、媒体票据 (off unless `LIBRARY_ENABLED`; see `library/CLAUDE.md`) |
| `admin/` | admin console (read-write since v2): cookie sessions, roles, CSRF, TOTP/step-up, hash-chained audit, recovery CLI, settings service, doctor/probes, user/room moderation, rank rules/ops, usage, announcements/maintenance, changelog (entries, per-user read position, draft import), backups, prompts; v1 cross-user queries |
| `routers/` | HTTP/WS endpoints (one `router` per module) |
| `main.py` | `create_app()` – wires state, middleware and routers |
| `static_config/` | JSON config snapshots served by `/api/config/{key}` |

## Allowed dependencies (enforced by `tests/test_architecture.py`)
- core -> models only; models -> core
- providers -> core (and no FastAPI/Starlette)
- speech, services -> core, models, providers
- realtime -> core, models, providers, speech, services
- rank, rooms -> core, models, providers, speech, services (rooms may also import agents); never each other or realtime
- wordbook -> core, models, providers, speech, services; only admin, routers and `main.py` import it (rank reads `wordbook_events` via models)
- agents -> core, models, providers, speech, services; only rooms, links, admin, routers and `main.py` import it (never rank or realtime)
- links -> core, models, providers, speech, services, rank, rooms, wordbook, agents; only routers and `main.py` import it (rank reads `link_credits` via models)
- library -> core, models, providers, speech, services; only admin, routers and `main.py` import it
- admin -> core, models, providers, speech, services, realtime, rank, rooms, wordbook, agents, library; only routers and `main.py` import admin
- routers -> anything above (incl. rank, rooms, wordbook, links, agents, library); only `main.py` (and other routers) import routers
- `core/learning_events.py` and `core/rank_sources.py` use the standard library only
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
Agents wiring in `create_app`: `agents_runtime(app)` builds the one `AgentsRuntime`, then `install_agent_sources(app)` registers the
links-layer sources unconditionally (each turn checks the switches); A2/A3/A5 append at the labelled anchor comments after it
and reach the runtime only through `runtime(app)` / `deps_for(app)`.
Library wiring: `library.worker.install(app)` builds `app.state.library` (queue, media tickets, fetch stage); the lifespan runs
its poll loop as `tasks["library"]` and calls `shutdown()` before the engine closes. Plan S2 (`library_import`) and plan A
(`admin_library`) append at the labelled anchor comments.
精选库:`library_catalog` 路由(用户)在 `library_import` 之后;计划 SI 在三处带 `plan SI` 字样的锚点装 `CatalogJobs` 与 `admin_catalog`。

## Tests
`cd server && uv run pytest -q`

## Pitfalls
- Absolute imports only (`from app.core.config import Settings`).
- Logger names follow `__name__`, except the pinned `app.timing` and
  `app.asr_stream.websockets` / `app.asr_realtime.websockets` channels; keep those strings.
- Never log keys, tickets, transcripts or user text; never commit `.env`.
- Migrations: `alembic/versions/` is linear (head `0023`); `tests/test_migrations.py::test_models_match_migrations`
  must stay green; every migration needs a SQLite (batch) + Postgres-safe path and a round-trip test.
  `0016_agent_memory` is shared with A3 (A3 appends `agent_tutor_sessions`).
- Room messages are kept forever (R-6 + owner ruling): nothing outside the M2 retention purge deletes `RoomMessage`;
  deleting a user never deletes rooms (`rooms.owner_id` nullable, `ON DELETE SET NULL`).
