# scripts/

Local operator scripts. Not imported by any app code, not shipped in the Docker image.

## What lives here
- `deploy.sh` – one-command deploy from this machine: preflight → push → SSH to the server → `git merge --ff-only` → `docker compose up -d --build` → health check.
- `deploy.env.example` – template for `deploy.env` (host, directory, branch, remote, health URL).
- `deploy.env` – **local only, git-ignored** (`/scripts/deploy.env` in `.gitignore`). Holds the server address; never commit or paste it.

## Usage (only when the user asks)
```bash
cp scripts/deploy.env.example scripts/deploy.env   # first time, then fill it in
scripts/deploy.sh --dry-run        # local checks + read-only probe of the server (no push, no pull, no rebuild)
scripts/deploy.sh                  # preflight (server pytest + web typecheck/test), push, deploy, health check
scripts/deploy.sh --skip-checks    # same without the test preflight
```

## Preconditions (the script refuses otherwise)
- The current branch equals `DEPLOY_BRANCH` (default `main`).
- The working tree is clean (`git status --porcelain` is empty, untracked files included).
- `DEPLOY_REMOTE` must be a remote this machine can **push** to and that the **server** also has under the same name (the script runs `git fetch <remote> <branch>` on the server). In this checkout `origin` is the upstream ZuodaoTech repo without write access, so point `DEPLOY_REMOTE` at the fork remote (add it with `git remote add <name> <fork-url>`).
- SSH key login to `DEPLOY_HOST`; the server directory holds the untracked `docker-compose.yml` and `server/.env`.

## Pitfalls
- A deploy runs `alembic upgrade head` when the container starts (see `server/Dockerfile`): back up the production database first when a release adds migrations, and check them against Postgres (the test suite runs on SQLite).
- Feature switches (agents, library, wordbook, links, link import, AI) default to off on the server; a deploy does not turn them on.
- The script does not roll back. If the health check fails it prints the last server logs; fix forward or redeploy the previous commit.
- Never run it from a feature branch, and never with `--skip-checks` for a release that has not been verified locally.
- `deploy.sh` pushes `DEPLOY_BRANCH` only; other branches are not pushed.
