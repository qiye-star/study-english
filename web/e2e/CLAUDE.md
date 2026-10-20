# web/e2e/

Playwright specs against the dockerised E2E stack with real upstreams (costs money).

## What lives here
- Specs: `login`, `practice`, `chat`, `lookup`, `grammar-prompt`, `progress`, `vocabulary`, `hold-to-talk`, `latency`, `scenario-spot-check`, `rank` (mocked `/api/rank/*`, zero upstream), `rooms` (two browser contexts, room AI off), `wordbook` / `wordbook-recall` / `wordbook-goals` (zero upstream; recall needs `WORDBOOK_SPOT_CHECK_PCT=100`; goals learns with 模糊 so it does not depend on it), `accounts` / `accounts-admin` (accounts v2: email register/login/reset, nickname, avatar, invite codes; admin batch codes, user invite card, email card, forced binding, avatar moderation; zero upstream; need the isolated stack with `EMAIL_BACKEND=console` and `support/accounts.ts::codeFor` which recovers codes from the test DB — one-off stacks only), `captcha` (人机验证 ALTCHA: API 与真实组件的用例 + 模式切换;zero upstream; ONE-OFF stack only — it sets `captcha_mode` through the admin API and needs the container-side solver in `support/captcha.ts`; the real-widget UI cases are `test.fixme` until the widget reset bug in the e2e results doc is fixed), `admin-v2` (admin console in a 1440 px desktop context + the mobile web page; needs `E2E_ADMIN_PASSWORD`, skipped otherwise; zero upstream; serial).
- `support/` — `auth.ts` (invite registration), `fake-mic.ts`/`mic.ts`, `touch.ts`, `header.ts`, `wordbook-db.ts` (makes a test user's words due: `E2E_SQLITE_PATH` or `E2E_COMPOSE_PROJECT`), `upstream-guard.ts` + `mock-upstreams.ts` (blocks paths that could reach an upstream unless the spec opts in).
- `package.json` declares CommonJS (Playwright 1.51 + Node 24 cannot load ESM `.ts` config).

## Run
- Start the stack (`docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait`), then `yarn web:e2e --project=chromium-mobile`. See `web/README.md`.

## Pitfalls
- Keep `__dirname` (not `import.meta.url`) and CommonJS; do not convert to ESM.
- `E2E_INVITE_CODE` is generated per run; never commit it. Upstream keys come from `server/.env`.
- Record results in `docs/superpowers/plans/e2e-results.md`; mark specs never run on Docker as unverified.
- `upstream-guard.ts` lets the rank/rooms config + `/api/rank/me|achievements` through (DB only); match and room-AI paths stay blocked.
- A new own-backend endpoint a spec clicks (e.g. the wordbook goals `/bonus`, `/enrollment/{pause,resume,reset}`) must be added to `upstream-guard.ts` and `src/test/e2e-upstream-guard.test.ts`, or the guard aborts the request and it never reaches the server.
- Type-checked by `yarn web:typecheck` (included in `tsconfig.json`), not run by vitest.
