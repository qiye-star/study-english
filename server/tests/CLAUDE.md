# server/tests/

pytest suite for the server (pytest-asyncio auto mode, respx for HTTP mocking).

## What lives here
- `conftest.py` – `make_settings(**overrides)` (fake upstream URLs/keys, in-memory SQLite or
  `TEST_DATABASE_URL`), fixtures `app`, `client` (httpx ASGI), `auth_headers` (registers alice)
- `test_<area>.py` – one file per module/endpoint area; `test_*_api.py` hit routers
- `background.py` – `drain_background(app)` / `cancel_background(app)`: await every app background task (see Conventions)
- `agents_helpers.py` – agents fakes: `FakeLLM` (httpx.MockTransport upstream), SSE parsing, `enable_agents`, `new_conversation`, `turn_body`, `check_contract`
- `test_agents_privacy.py` – caplog (scoped to logger `app`) over every agents / memory / admin-agents endpoint, after-turn hooks, the memory worker and sources; also pins that agents routes carry no text in URLs (new routes must be added there)
- `test_architecture.py` – AST import scan enforcing the `app/` layering rules
- `library_helpers.py` – library fakes: `FakeTools` (no ffmpeg needed), `FakeAsr`, `FakeTimedAsr` (`use_fakes(timed_asr=)`; passing `asr=` turns the timed transcriber off), `fake_media`, `enable`, `library_settings`, `upload` (chunked), `process` (one worker round + drain)
- `library_words.py` – v2 helpers: word-timed utterances / chunks / tokens (`words_at`, `utt`, `chunk`, `tok`, `run`)
- `test_library_privacy.py` – caplog over every `/api/library` endpoint (incl. the D8 translate / analysis paths) and the worker paths; pins that library routes carry only ids, `cursor` and `ticket` (new routes must be added there)
- `test_library_asr_timed.py` / `test_library_quality.py` / `test_library_alignment.py` – real sentence times, the sanity check, the continuous-background-music fixture; `test_library_reprocess.py` – re-recognition state machine and allowance
- `test_library_chunks_v3.py` / `test_library_timeline.py` / `test_library_wordseg.py` / `test_library_quality_v2.py` / `test_library_sentences.py` – the word-time algorithm (pure); `test_library_words_pipeline.py` / `test_library_rebuild.py` – pipeline wiring, kept transcript, rebuild endpoint; `test_library_alignment_eval.py` – the evaluation script
- `test_library_ai.py` / `test_library_ai_api.py` – sentence translation and analysis: pure functions, per-sentence allowances, write-back, editable prompts; endpoints against a respx fake LLM
- `test_changelog_privacy.py` – caplog + audit + command-output scan for entry text, static no-logging check of the four changelog modules, pinned `/api/changelog*` and `/api/admin/changelog*` route table (new routes must be added there); `test_changelog_import.py` also validates every `docs/changelog/*.json`
- `fixtures/` – ISE XML samples, `sentence_cases.json` (shared with web's sentence splitter),
  `rank_contract.json` / `rooms_contract.json` / `room_mentions.json` / `agents_contract.json` (shared with web contract tests; the agents one is recorded by `test_agents_contract.py`, uuids/times/ms are fixed by `agents_helpers.stable`);
  `dictionary_contract.json` (recorded by `test_dictionary_contract.py`; web `dictionary-contract.test.ts` reads it);
  `library_contract.json` (recorded by `test_library_contract.py`; web `library-contract.test.ts` reads it; tickets written `REDACTED`);
  `changelog_contract.json` (recorded by `test_changelog_contract.py`; web `changelog-contract.test.ts` and admin `features/changelog/api.test.ts` read it; timestamps fixed);
  `agents_memory_contract.json` (web `memory-contract.test.ts`); `agents_tutor_contract.json` (recorded by `test_agents_tutor_contract.py`; helpers in `agents_tutor_helpers.py`)
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
- Background tasks vs the shared SQLite connection: tests use one in-memory connection (StaticPool), so any task that
  outlives its response (agents after_turn hooks, memory worker, rooms summary/presence tasks, links judge, realtime
  drains) interleaves with the next request or, after teardown disposed the engine, fails with `Cannot operate on a
  closed database` / `KeyError: 'connection'`. Rule: the `app` fixture drains (then cancels) them on teardown via
  `tests/background.py`; a test that fires another request right after a spawning one calls
  `await drain_background(app)` (never sleeps, never a hand-picked task set such as `runtime(app).tasks` alone).
  A new fire-and-forget task set in `app/` must be added to `_task_sets` there. Tasks that sleep by design (the room tutor's 60 s
  timers, `RoomTutor.timers()`) are cancel-only (`timer_tasks`): `drain_background` never waits for them; tests that need them to
  fire inject `sleep` into `RoomTutor` (see `test_rooms_agent_tutor.py::Clockwork`).
- Log-hygiene tests assert keys/transcripts/tickets never appear in records: keep them.
- Cancelling a task mid SQLite query (a WebSocket handler cancelled by TestClient's `__exit__`, a shutdown) used to hang forever: SQLAlchemy 2.1's
  `terminate()` force-stops the aiosqlite thread, then the shielded graceful `close()` queues behind the stop sentinel. `app.core.db` guards it
  (`_harden_aiosqlite_terminate`); `test_db_cancel.py` pins it. A hang in `testclient.py __exit__` is not necessarily lifespan shutdown: dump the
  portal loop's tasks (`cr_await` chain) before touching shutdown code. Any wait in a new test on a worker thread / portal gets a hard timeout
  (`asyncio.wait_for`, `anyio.fail_after`) so a regression fails instead of stalling the run.
