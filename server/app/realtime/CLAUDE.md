# app/realtime/

Server side of realtime voice calls (`WS /api/realtime?ticket=...`, off unless `REALTIME_ENABLED`).

## What lives here
- `realtime_protocol.py` – JSON control messages + binary audio frames; must match
  `web/src/features/realtime/protocol.ts` field for field (snake_case)
- `realtime_session.py` – `RealtimeSession`: per-call turn state machine (ASR -> LLM -> TTS,
  interrupts, limits); depends only on Protocols (`MessageStore`, `Assessor`, `Upstreams`)
- `realtime_providers.py` – concrete wiring: OpenAI-compatible LLM stream, Volcengine TTS
  stream, recognizer selection (R25), DB message store, iFlytek assessor
- `realtime_tickets.py` – one-time short-lived tickets (`TicketStore`) and call registry/caps

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`. Never routers
(enforced by `tests/test_architecture.py`). The WebSocket endpoint itself is `app/routers/realtime.py`.

## Entry points
`RealtimeSession`, `make_recognizers`, `make_assessor`, `TicketStore`, `RealtimeRegistry`,
`parse_client_message`.

## Tests
`uv run pytest -q tests/test_realtime_protocol.py tests/test_realtime_session.py tests/test_realtime_providers.py tests/test_realtime_tickets.py tests/test_realtime_ws.py tests/test_realtime_assessor.py`

## Pitfalls
- The ticket is a bearer secret: never log it (uvicorn lines are redacted by `core.logging_setup`).
- Never log transcripts, replies, prompts or keys; log kinds, ids and numbers only.
- Protocol changes need the matching web change and tests on both sides.
