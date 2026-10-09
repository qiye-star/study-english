# app/routers/

HTTP and WebSocket endpoints. Each module exposes one `router = APIRouter(...)`, registered in
`app/main.py`.

## What lives here
`health` (/up), `sessions` (auth/users), `config_api` (/api/config/{key} from `static_config/`),
`ai_chat`, `ai_audio` (TTS/STT proxy), `grammar`, `grammar_prompt`, `speech` (Azure tokens,
iFlytek assessments), `conversations`, `assessments`, `practice_items`, `vocabulary`, `stats`,
`realtime` (config, ticket, WS), `rank` (/api/rank/*), `rooms` (/api/rooms/*, WS /api/rooms/ws), `admin` (/api/admin/*, read-only), `stubs` (catch-all writes),
`admin_web` (static admin/dist at /admin), `web` (static web/dist + SPA fallback).

## Allowed dependencies
Anything below: core, models, providers, speech, services, realtime, rank, rooms, admin, and other routers.
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
- Map vendor exceptions to HTTP here; errors render as `{"error": ...}`.
- Never log request bodies, tickets, keys or user text. New strings exposed to the web UI need zh+en locales on the web side.
