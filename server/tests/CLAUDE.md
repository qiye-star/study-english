# server/tests/

pytest suite for the server (pytest-asyncio auto mode, respx for HTTP mocking).

## What lives here
- `conftest.py` – `make_settings(**overrides)` (fake upstream URLs/keys, in-memory SQLite or
  `TEST_DATABASE_URL`), fixtures `app`, `client` (httpx ASGI), `auth_headers` (registers alice)
- `test_<area>.py` – one file per module/endpoint area; `test_*_api.py` hit routers
- `agents_helpers.py` – agents fakes: `FakeLLM` (httpx.MockTransport upstream), SSE parsing, `enable_agents`, `new_conversation`, `turn_body`, `check_contract`
- `test_agents_privacy.py` – caplog (scoped to logger `app`) over every agents / memory / admin-agents endpoint, after-turn hooks, the memory worker and sources; also pins that agents routes carry no text in URLs (new routes must be added there)
- `test_architecture.py` – AST import scan enforcing the `app/` layering rules
- `fixtures/` – ISE XML samples, `sentence_cases.json` (shared with web's sentence splitter),
  `rank_contract.json` / `rooms_contract.json` / `room_mentions.json` / `agents_contract.json` (shared with web contract tests; the agents one is recorded by `test_agents_contract.py`, uuids/times/ms are fixed by `agents_helpers.stable`);
  `agents_memory_contract.json` (web `memory-contract.test.ts`)
- `test_web_contract.py` – drives a real room session and pins every rooms HTTP/WS payload shape in
  `fixtures/rooms_contract.json` (web reads it in `rooms-contract.test.ts`); regenerate after an intentional
  change with `CONTRACT_UPDATE=1` (tickets are written redacted)

## Allowed dependencies
Anything in `app`, plus other test modules' helpers (`from tests.test_x import helper`).

## Commands (from `server/`)
- All: `uv run pytest -q` (~2.5 min; run halves by file glob if a runner caps time)
- One file: `uv run pytest -q tests/test_realtime_ws.py`
- Postgres: `TEST_DATABASE_URL=postgresql+asyncpg://... uv run pytest -q`

## Conventions / pitfalls
- Override settings per test with `@pytest.mark.parametrize("settings_overrides", [...], indirect=True)`
  or by redefining the `settings_overrides` fixture in the module.
- Monkeypatch targets are dotted strings (`"app.speech.asr.transcribe_pcm"`): patch where the
  name is looked up, and update the string when a module moves.
- Never call real vendors or put real keys in tests; use respx / fake sockets and dummy keys.
- Log-hygiene tests assert keys/transcripts/tickets never appear in records: keep them.
