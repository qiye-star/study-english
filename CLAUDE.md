# everyone-can-use-english (self-hosted fork)

Upstream Enjoy desktop app + our self-hosted backend (`server/`) + mobile-first PWA (`web/`).

## Directory map
- `web/` — mobile PWA (React + Vite + vitest). Ours. See `web/CLAUDE.md`.
- `server/` — FastAPI backend (uv, alembic, pytest); also serves the built web app. Ours. See `server/README.md`.
- `docs/` — specs, plans, design notes for our work. See `docs/CLAUDE.md`.
- `enjoy/` — upstream Electron desktop app. Read-only for web work; web reuses it only via `web/src/shims` and the `@renderer/*` alias.
- `1000-hours/`, `1000h-portal/`, `book/`, `entry/`, `new-edition-drafts/` — upstream content/sites. Do not restructure.
- `docker-compose.yml` (server + optional `postgres` profile), `docker-compose.e2e.yml` (isolated E2E stack, port 8100).

## Run / test
- Web dev: `yarn web:dev` (http://localhost:5173, proxies `/api` + WebSocket to :8000).
- Web checks: `yarn web:typecheck && yarn web:test && yarn web:build`; E2E: `yarn web:e2e --project=chromium-mobile` (needs the E2E stack, real upstreams, costs money).
- Server: `cd server && uv run alembic upgrade head && uv run uvicorn app.main:create_app --factory --port 8000`; tests `cd server && uv run pytest -q`.
- Yarn 4 workspaces (`enjoy`, `1000-hours`, `1000h-portal`, `web`). In a git worktree, junction/symlink `node_modules` (root and `web/`) from the main checkout instead of reinstalling.

## Deploy
- `docker-compose.yml` is NOT tracked (per-deployment, git-ignored): first `cp docker-compose.example.yml docker-compose.yml`, then `docker compose up -d --build` builds web (`yarn workspace web build`) into the server image; the container runs `alembic upgrade head` then uvicorn on 127.0.0.1:8000. Put HTTPS + WebSocket-capable reverse proxy in front (see `server/README.md`).
- Rebuild/restart containers only when the user asks.

## Security rules
- Never commit `.env`, `server/.env`, API keys, invite codes, access tokens, realtime tickets, or recordings. Only `*.env.example` files with placeholders are tracked.
- Never log or paste tokens/tickets (the realtime ticket travels in a WebSocket query string; keep it out of logs, errors and test snapshots).
- Never edit `enjoy/` (or other upstream dirs) to make web work; add a shim in `web/src/shims` instead.
- Do not send user data to third-party hosts from web code; all upstream calls go through `server/`.

## Conventions
- Commits: conventional style (`feat(web): …`, `fix(server): …`), one logical change per commit, tests green after each.
- Plans in `docs/superpowers/plans/` are the source of truth for in-flight work; follow their rulings.
- Learning links (`LINKS_ENABLED`, default off): server `app/links/` is a top layer fed by post-commit events from
  `app/core/learning_events.py`; web contributes through `web/src/plugins/` + `~/lib/extension-points`. Never put words,
  message text or user ids in URLs or logs (see `server/app/links/CLAUDE.md`).
