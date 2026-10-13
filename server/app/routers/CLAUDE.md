# app/routers/

HTTP and WebSocket endpoints. Each module exposes one `router = APIRouter(...)`, registered in
`app/main.py`.

## What lives here
`health` (/up), `sessions` (auth/users), `config_api` (/api/config/{key} from `static_config/`),
`ai_chat`, `ai_audio` (TTS/STT proxy), `grammar`, `grammar_prompt`, `speech` (Azure tokens,
iFlytek assessments), `conversations`, `assessments`, `practice_items`, `vocabulary`, `stats`,
`realtime` (config, ticket, WS), `rank` (/api/rank/*), `rooms` (/api/rooms/*, incl. `ended`, `{id}/reopen`; WS /api/rooms/ws),
`wordbook` (/api/wordbook/*: config, books, enrollment, today, learn/review batches, answers (incl. `mode=free`), spell, cards, reports, explain, `learned/summary`, `learned/query`,
`learned/card`, `free/start`: words and prefixes only in POST bodies, never in URLs), `dictionary` (`/api/dictionary/lookup`: 选词词典,词只在 POST 体,`limited_user`,不受 WORDBOOK_ENABLED 控制;逻辑在 `app/wordbook/lookup.py`;须在 `stubs` 之前), `admin_auth` (admin login/logout/session, TOTP, step-up, own password), `admin` (v1 read-only /api/admin/*),
`announcements` (public `GET /api/announcements`: active banners + maintenance state),
`admin_accounts` (accounts, sessions, `/me/security`, audit list/verify), `admin_settings` (settings CRUD, revisions/revert,
export/import, doctor, probes), `admin_rank` (rules draft/validate/simulate/publish, user rank ops, matches, reset-all),
`admin_users` (moderation, quota overrides, invites), `admin_rooms` (room list/detail/actions incl. reopen via
`rooms.runtime(app)`, reports), `admin_wordbook` (/api/admin/wordbook: overview, dictionary reload, sentence reports
hide/dismiss via `admin/wordbook_admin.py`), `admin_links` (/api/admin/links: learning-links view via
`app/links/admin_view.py`, operator breaker reset audited `links.breaker.reset`), `admin_agents` (/api/admin/agents: overview, persona query (POST) / disable / restore / edit / delete (step-up), reports, function calling probe via `app/admin/agents_admin.py`), `links` (/api/links/*: `GET config`, `PUT prefs`, plus each link's
sub-router from `app.links.registry`; must precede `stubs`), `admin_usage` (summary, top users, health), `admin_ops` (system, logs, announcements,
maintenance, backups, housekeeping), `admin_prompts` (prompt versions, test run), `agents_memory` (/api/agents/memory/*: profile, items, pin, recaps, export, clear — own data only; must precede `agents` and `stubs`),
`agents_tutor` (/api/agents/tutor/*: start, active, get, hint, skip, finish; the turn itself is `POST /api/agents/turn` with `mode=tutor`; logic in `app/agents/tutor/service.py`; must precede `stubs`),
`library` (/api/library/*: config, chunked uploads, items, retry/cancel, subtitles, sentence edits, media tickets + ticket-only media with Range, poster, shadowing attempts, per-sentence `translate` and `analysis` (D8; AI switch `LIBRARY_AI_ENABLED`); logic in `app/library/`; ids only in URLs; must precede `stubs`),
`stubs` (catch-all writes),
`app/links/admin_view.py`, operator breaker reset audited `links.breaker.reset`), `links` (/api/links/*: `GET config`, `PUT prefs`, plus each link's
sub-router from `app.links.registry`; must precede `stubs`), `agents` (/api/agents/*: config, personas CRUD + report, settings, `POST /turn` SSE via `AgentStream`; memory (A2) and tutor (A3) append below the anchor comments at the end of the file; must precede `stubs`), `admin_usage` (summary, top users, health), `admin_ops` (system, logs, announcements,
maintenance, backups, housekeeping), `admin_prompts` (prompt versions, test run), `stubs` (catch-all writes),
`admin_web` (static admin/dist at /admin), `web` (static web/dist + SPA fallback).

## Allowed dependencies
Anything below: core, models, providers, speech, services, realtime, rank, rooms, wordbook, links, admin, and other routers.
Nothing outside `routers/` and `main.py` may import a router (`tests/test_architecture.py`):
logic needed elsewhere belongs in `app/services/` (routers may re-export it).

## Entry points
`create_app()` registration order matters: real APIs first, then `stubs`, `admin_web`, `web` last.
`config_api.py`, `web.py` and `admin_web.py` locate files relative to this directory (`../static_config`,
`../../../web/dist`, `../../../admin/dist`): moving them breaks paths.

## Tests
`uv run pytest -q` (router tests are `tests/test_*_api.py`, `test_ai_*`, `test_realtime_ws.py`, ...)

## Pitfalls
- Auth via `Depends(current_user)` / `limited_user` (rate-limited) from `app.core.deps`.
- Every `/api/admin/*` route declares a role: `Depends(app.admin.perms.require("viewer"|"operator"|"superadmin"))`
  or a step-up dependency (`tests/test_admin_routes_guarded.py` walks FastAPI's included routers and also rejects
  duplicate method+path); writes audit in the same transaction. Keep admin routers thin: logic in `app/admin/`.
- `rooms.deps_for` injects the published `rooms.assist` / `rooms.voice_translate` / `rooms.summary` templates (`prompt_cache`, no DB read per
  call) into `ConnDeps.templates`.
- Map vendor exceptions to HTTP here; errors render as `{"error": ...}`.
- Never log request bodies, tickets, keys or user text. New strings exposed to the web UI need zh+en locales on the web side.
- SSE agent turns must use `AgentStream` (closes the event iterator in `finally`); never a bare `StreamingResponse`.
