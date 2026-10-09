# app/rooms/

Multiplayer practice rooms: 6-digit codes, persisted messages with per-room `seq`, in-memory hub
(connections, locks, rate windows), private assistant lane and public `@ai` answers.
Spec: `docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md` §5. Off unless `ROOMS_ENABLED`.

## What lives here
- `protocol.py` – WS messages and close codes; mirrored by `web/src/features/rooms/protocol.ts`
- `codes.py`, `rules.py` – codes, text cleaning, `@ai` parsing, limits (pure)
- `store.py` – all DB access (create/join/seq/replay/sweep/purge)
- `hub.py`, `tickets.py` – connections + broadcast, one-time tickets (in-process, single worker)
- `assistant.py` – assistant/`@ai` prompts and parsing (pure)
- `connection.py` – one socket's message handling

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`. Never `rank`, `realtime`,
`admin` or `routers`. Endpoints and lifespan hooks: `app/routers/rooms.py`.

## Tests
`uv run pytest -q tests/test_rooms_*.py`

## Pitfalls
- The ticket is a bearer secret in the WS query string: never log it.
- Private-lane messages go only to `audience_id`; replay queries must filter the same way.
- State that must survive a restart lives in the DB; the hub holds only connections.
- Protocol changes need the matching web change (`protocol.test.ts` reads this package's file).
