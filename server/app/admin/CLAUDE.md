# app/admin/

Read-only admin console logic behind `/api/admin/*` (routers `admin.py`, `admin_web.py`).
Disabled unless `ADMIN_USERNAME` and `ADMIN_PASSWORD` (>= 12 chars) are set; then 404 everywhere.

## What lives here
- `auth.py` – env-var credential check (constant-time), stateless HMAC admin tokens signed with
  `app.state.admin_secret`, FastAPI guards `require_enabled` / `admin_required`
- `service.py` – cross-user read queries: overview totals + daily buckets, users, conversations
  and messages (with grammar notes), assessments, practice items, vocabulary; pagination helpers

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`, `app.realtime`.
Only `app/routers/` and `app/main.py` may import `app.admin` (enforced by
`tests/test_architecture.py`). Never import routers from here.

## Entry points
`auth.admin_required` (router dependency), `auth.issue_token` / `verify_token`,
`service.overview`, `list_users`, `get_user`, `list_conversations`, `conversation_messages`,
`list_assessments`, `get_assessment_row`, `list_practice_items`, `list_vocabulary`.

## Tests
`uv run pytest -q tests/test_admin_api.py tests/test_admin_auth.py tests/test_admin_web.py`

## Pitfalls
- Strictly read-only: no writes, no deletes. Admin tokens never share format/secret with user tokens.
- `ADMIN_SESSION_SECRET` empty => random per process; restarts log admins out.
- `admin_web` must be registered before `web` (SPA fallback) in `create_app`.
- Never log admin credentials, tokens, user text or recording paths.
