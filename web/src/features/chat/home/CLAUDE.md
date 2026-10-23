# web/src/features/chat/home/

Chat home (plan `docs/superpowers/plans/2026-10-23-chat-home-daily-greeting-web.md`): `/chat` = today's default conversation, history drawer, settings sheet, daily greeting. Everything is behind the server flag `CHAT_HOME_ENABLED` (`GET /api/chat-home/config`); off = the old list and conversation pages, unchanged.

## What lives here
- `chat-home-api.ts` — client + types for `/api/chat-home/*` (contract: server plan 5.1), `cleanGreeting` (not exactly 3 valid lines = no greeting), error table.
- `emphasis.ts` — `*…*` emphasis parser (FR19, same rules as server R17). Render with React nodes only.
- `chat-home-contract.test.ts` reads the server fixture `server/tests/fixtures/chat_home_contract.json` (test-fixture exception). `chat-home-contract.stub.json` is only a hand-written sample (stable ids like `c-today`) for the store / drawer / sheet / route tests; it is not a contract.
- `routes.tsx` (main bundle) → lazy `chat-home-shell.tsx` (today / new / conversation) with `home-chrome.tsx`, `history-drawer.tsx`, `chat-settings-sheet.tsx`, `new-chat.tsx`, `role-hint.tsx`, `empty-day.tsx`; `greeting-popup.ts` = trigger rules (daily / every_open / off, only `kind="today"`), `greeting-modal.tsx` (lazy) + `greeting-fly.ts` (close fly-in), `greeting-group.tsx` (the three greeting bubbles in today's chat).
- `chat-home-store.ts` (`/today` result, in memory), `chat-home-open.ts` + `open-effect.ts` (app-open detection), `use-chat-home-config.ts` (flag).
- `test-routes.tsx` — shared harness for the route / parity / group tests (not shipped; nothing imports it).

## Rules
- Privacy: URLs carry only conversation ids and fixed paths; query keys are `page`, `per_page`, `hide_idle_daily`, `tz_offset_minutes`. Never log greeting text, facts or messages; errors carry codes only. `localStorage` holds dates and booleans only; the `/today` result lives in memory and is cleared on logout.
- Config keys: the web types say `zhNote` / `agentPersonaId`; `ApiClient` converts to snake_case on the wire (FR0). Never write snake_case keys by hand.
- Lazy loading: shell, drawer, sheet and modal are lazy chunks; only the flag hook, store, open detection and route dispatch may sit in the main bundle (budget +0.5 kB gzip for the whole feature).
- No `dangerouslySetInnerHTML` in this folder, no `backdrop-filter` (glass budget), animations via CSS / Web Animations API only (no new dependencies).
- Strings live in `home/locales/{en,zh-CN}.json` (keys under `web.chat.home.*`), registered lazily by `locales.ts` (each lazy module does `import "./locales"`). Do NOT put them in an `i18n/` folder: that glob is merged into the main bundle (measured about +1.2 kB gzip).
- Logout: modules that hold per-user state register a reset with `onChatHomeReset` (`chat-home-cache.ts`, tiny, main bundle); `clearChatHomeCache` runs them.
- Never edit `enjoy/`; no third-party hosts.

## Test
- `cd web && yarn vitest run src/features/chat/home`
