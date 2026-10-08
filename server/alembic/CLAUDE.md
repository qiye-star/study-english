# server/alembic/

Database migrations (Alembic, async engine; SQLite by default, Postgres supported).

## What lives here
- `env.py` – imports `app.models` (registers tables on `Base.metadata`) and reads
  `DATABASE_URL` from `app.core.config.Settings`; batch mode on SQLite
- `versions/` – numbered revisions `000N_<slug>.py` (linear history)
- `script.py.mako` – revision template; config in `../alembic.ini`

## Allowed dependencies
`app.core.config`, `app.core.db`, `app.models` only. Revisions must not import app code at
all: write explicit `op.*` operations so old revisions keep working after models change.

## Entry points (run from `server/`)
- Upgrade: `uv run alembic upgrade head` (the container runs this before uvicorn)
- New revision: `uv run alembic revision -m "short slug"`, then rename to the next `000N_` number
  and set `down_revision` to the previous one

## Tests
`uv run pytest -q tests/test_migrations.py` – upgrades a fresh DB and asserts it matches
`Base.metadata` (no autogenerate drift).

## Pitfalls
- Every model change needs a revision in the same commit, or `test_migrations` fails.
- Never edit an already-released revision; add a new one.
- `DATABASE_URL` may hold credentials: never echo it or commit `.env`.
