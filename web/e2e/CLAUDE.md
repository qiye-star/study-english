# web/e2e/

Playwright specs against the dockerised E2E stack with real upstreams (costs money).

## What lives here
- Specs: `login`, `practice`, `chat`, `lookup`, `grammar-prompt`, `progress`, `vocabulary`, `hold-to-talk`, `latency`, `scenario-spot-check`, `rank` (mocked `/api/rank/*`, zero upstream), `rooms` (two browser contexts, room AI off), `admin-v2` (admin console in a 1440 px desktop context + the mobile web page; needs `E2E_ADMIN_PASSWORD`, skipped otherwise; zero upstream; serial).
- `support/` — `auth.ts` (invite registration), `fake-mic.ts`/`mic.ts`, `touch.ts`, `header.ts`, `upstream-guard.ts` + `mock-upstreams.ts` (blocks paths that could reach an upstream unless the spec opts in).
- `package.json` declares CommonJS (Playwright 1.51 + Node 24 cannot load ESM `.ts` config).

## Run
- Start the stack (`docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait`), then `yarn web:e2e --project=chromium-mobile`. See `web/README.md`.

## Pitfalls
- Keep `__dirname` (not `import.meta.url`) and CommonJS; do not convert to ESM.
- `E2E_INVITE_CODE` is generated per run; never commit it. Upstream keys come from `server/.env`.
- Record results in `docs/superpowers/plans/e2e-results.md`; mark specs never run on Docker as unverified.
- `upstream-guard.ts` lets the rank/rooms config + `/api/rank/me|achievements` through (DB only); match and room-AI paths stay blocked.
- Type-checked by `yarn web:typecheck` (included in `tsconfig.json`), not run by vitest.
