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

## enjoy-export (local export of desktop videos)
- `enjoy-export.mjs` + `enjoy-export/` read the local Enjoy desktop database (a temporary, read-only copy) and write a zip package: `manifest.json` plus `items/<source_md5>/{meta.json,subtitle.srt,media.<ext>}`. Each subtitle is the desktop's own transcription turned into SRT, so the cloud does not need to transcribe. The package format is in `docs/superpowers/plans/2026-10-27-library-local-export-cloud-import.md` (R-P1 to R-P6). The admin console imports it under 精选库 → 导入包.
- Usage (only when the user asks): `yarn export:enjoy [--library <dir>] [--user <name>] [--db <file>] [--out <zip>] [--pick | --list] [--force] [--dev]`. `--pick` lists, then asks for `all`, `1,3,5-8` or an empty line to cancel; it needs an interactive terminal. Tests: `yarn scripts:test`.
- Requires Node 22.13 or later (built-in `node:sqlite`). No npm dependencies.
- Library folder lookup, in order: `LIBRARY_PATH`; the `library` key of `settings.json` (`SETTINGS_PATH` is a directory that overrides the Electron userData location: Windows `%APPDATA%\Enjoy\`, macOS `~/Library/Application Support/Enjoy/`, Linux `${XDG_CONFIG_HOME:-~/.config}/Enjoy/`); then the default `<Documents>/EnjoyLibrary`. Not verified on real installs, and a OneDrive-redirected Documents folder is not found. In that case pass `--library`.
- Privacy: only the `library` key of `settings.json` is read; the script makes no network calls. The package has no user id, token, local path, original file name or `videos.source`. Titles are printed only in the local terminal. The zip holds the user's videos and subtitles, so do not upload it to a public place. `/enjoy-export-*.zip` and `*.zip.partial` are git-ignored.
- Exit codes: 0 done (or a cancelled pick); 1 error; 2 usage or refused (output exists without `--force`, not enough disk, several user folders, `--pick` without a terminal); 3 nothing exportable (no file written); 130 interrupted (the partial file is removed).
- Golden sample: `admin/src/features/catalog/fixtures/enjoy-export-v1.zip`, read by the admin importer tests. `scripts/enjoy-export/golden.test.mjs` checks it byte for byte. Regenerate only with `UPDATE_GOLDEN=1` after a format change agreed in the plan.
- Not verified on a real desktop database: the timeline unit (seconds) and shape, the `state` distribution, how often the compressed copy exists, a consistent copy while Enjoy is running (quit Enjoy before exporting), and Node 22.13 itself (only Node 24 was run).
