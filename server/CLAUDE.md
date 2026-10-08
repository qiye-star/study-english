# server/

Self-hosted FastAPI backend for Enjoy (web app + desktop): auth, config snapshots, AI proxying
(LLM / TTS / STT / Azure Speech / iFlytek ISE), persisted web data and realtime voice calls.
Python 3.12, uv-managed (`pyproject.toml`, `uv.lock`).

## What lives here
- `app/` – the application package (layered; see `app/CLAUDE.md`)
- `alembic/` + `alembic.ini` – database migrations
- `tests/` – pytest suite (includes the layering test `tests/test_architecture.py`)
- `scripts/` – manual smoke / latency / eval tools against a running server (not imported by app)
- `Dockerfile` – built from the repo root via `docker-compose.yml`; also builds `web/dist`
- `.env.example` – documented settings; copy to `.env` locally

## Entry points
- ASGI factory: `app.main:create_app` (`uvicorn app.main:create_app --factory`)
- Container CMD: `alembic upgrade head` then uvicorn; health check is `GET /up`

## Commands (run from `server/`)
- Tests: `uv run pytest -q` (whole suite ~2.5 min; split by file if a runner caps time)
- Dev server: `uv run uvicorn app.main:create_app --factory --reload`
- Migrations: `uv run alembic upgrade head`; new one: `uv run alembic revision -m "..."`

## Rules / pitfalls
- Never commit `.env`; never print or log keys, tokens, realtime tickets, user text or transcripts.
- Layering is enforced by `tests/test_architecture.py`; fix the design, do not loosen the test.
- `enjoy/` (desktop app) is upstream: never edit it from server work.
- Behavior changes need tests; keep `pytest` green before committing.
