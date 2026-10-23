# web/src/features/chat/home/

Chat home (plan `docs/superpowers/plans/2026-10-23-chat-home-daily-greeting-web.md`): `/chat` = today's default conversation, history drawer, settings sheet, daily greeting. Everything is behind the server flag `CHAT_HOME_ENABLED` (`GET /api/chat-home/config`); off = the old list and conversation pages, unchanged.

## What lives here
- `chat-home-api.ts` — client + types for `/api/chat-home/*` (contract: server plan 5.1), `cleanGreeting` (not exactly 3 valid lines = no greeting), error table.
- `emphasis.ts` — `*…*` emphasis parser (FR19, same rules as server R17). Render with React nodes only.
- `chat-home-contract.stub.json` — stub of the server contract fixture (swap for `server/tests/fixtures/chat_home_contract.json` when it exists).
- Later tasks add the store, open detection, drawer, settings sheet, greeting modal (see the plan's file list).

## Rules
- Privacy: URLs carry only conversation ids and fixed paths; query keys are `page`, `per_page`, `hide_idle_daily`, `tz_offset_minutes`. Never log greeting text, facts or messages; errors carry codes only. `localStorage` holds dates and booleans only; the `/today` result lives in memory and is cleared on logout.
- Config keys: the web types say `zhNote` / `agentPersonaId`; `ApiClient` converts to snake_case on the wire (FR0). Never write snake_case keys by hand.
- Lazy loading: shell, drawer, sheet and modal are lazy chunks; only the flag hook, store, open detection and route dispatch may sit in the main bundle (budget +0.5 kB gzip for the whole feature).
- No `dangerouslySetInnerHTML` in this folder, no `backdrop-filter` (glass budget), animations via CSS / Web Animations API only (no new dependencies).
- Never edit `enjoy/`; no third-party hosts.

## Test
- `cd web && yarn vitest run src/features/chat/home`
