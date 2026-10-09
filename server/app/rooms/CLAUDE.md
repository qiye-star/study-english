# app/rooms/

Multiplayer practice rooms: 6-digit codes, persisted messages with per-room `seq`, in-memory hub
(connections, locks, rate windows), private assistant lane and public `@ai` answers. v2 adds seven room settings,
approval joins and invite links, voice messages (transcribed once, translated once, shared by the room), quotes,
reactions, typing activity and a learning summary when a room ends.
Specs: `docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md` §5 (v1),
`docs/superpowers/specs/2026-10-10-rooms-v2-design.md` (v2). Off unless `ROOMS_ENABLED`; voice and summary have
their own sub-switches (`ROOMS_VOICE_ENABLED`, `ROOMS_SUMMARY_ENABLED`, default off).

## What lives here
- `protocol.py` – WS messages and close codes (protocol v2 is additive only); mirrored by `web/src/features/rooms/protocol.ts`
- `codes.py`, `rules.py` – codes, text cleaning, `@ai` parsing, limits (`RoomLimits`), `clean_settings` (one rule
  for owner and admin edits) (pure)
- `scenarios.py` – static scenario pool; `brief` goes into prompts only, never to the web (pure)
- `store.py` – all DB access for rooms/messages/members/join requests/invites/reactions (create/join/seq/replay/sweep/purge)
- `hub.py`, `tickets.py` – connections + broadcast, one-time tickets (in-process, single worker)
- `assistant.py` – assistant/`@ai`/summary/voice-translate prompts and parsing (pure). Prompts are templates (`DEFAULT_ASSIST_TEMPLATE`,
  `DEFAULT_ANSWER_TEMPLATE`, rendering exactly the M4 messages — pinned by `tests/fixtures/rooms_prompts_legacy.json`); a published
  admin version (`rooms.assist` / `rooms.answer`, via `ConnDeps.templates`) replaces them; a `[[user]]` line splits
  system/user message; invalid templates fall back to the default; learner text is escaped before `str.format`
- `connection.py` – one socket's message handling (say, assist, react, typing, voice_translate/voice_retry dispatch)
- `audio.py` – WAV checks (16 kHz mono PCM16 only), MP3 encoding via `lameenc` (lazy import, WAV fallback), file
  layout `room_audio/{room}/{msg}.{mp3|wav}` and staging `room_audio/_staging/{msg}.wav`; `read_file`/`write_file`/`delete_file`
- `voice_store.py` – `room_voice` rows: append, transcript/translation state, `used_bytes`, `audio_ref` (playback)
- `voice.py` – `VoiceService`: upload (validation, quotas, dedupe by `client_id`), background transcription and
  translation (metered `rooms_voice`), sender-only retries (max 3), staging sweep, resume after restart
- `summary.py` (pure: eligibility, context, strict JSON parsing, per-person view), `summary_store.py` (`SummaryStore`,
  `SummaryRunner`: one capped LLM call per ended room, metered `rooms_summary` with no user)

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`. Never `rank`, `realtime`,
`admin` or `routers`. Endpoints and lifespan hooks: `app/routers/rooms.py`, `rooms_voice.py`, `rooms_summary.py`;
admin side in `app/admin/rooms_admin.py` + `app/routers/admin_rooms.py` (playback uses `audio.read_file`).

## Tests
`uv run pytest -q tests/test_rooms_*.py tests/test_admin_rooms_v2.py tests/test_admin_storage.py`
Contract fixtures (`CONTRACT_UPDATE=1` re-records): `tests/fixtures/rooms_contract.json`, `rooms_v2_core_contract.json`,
`rooms_v2_voice_contract.json`, `rooms_v2_summary_contract.json`; the web checks each key.

## Pitfalls
- The ticket is a bearer secret in the WS query string: never log it. Invite tokens are just as secret (R2-5):
  not in logs, errors, audit summaries, or any response to a non-member; rotating makes the old link 404.
- Never log transcripts, translations, summary text, user text or absolute paths; voice logs carry only ids,
  durations, byte counts, statuses and exception class names (`caplog` assertions guard each background task).
- Room audio lives under `DATA_DIR/room_audio/`, **never under `recordings/`** (R2-18: the admin orphan-recordings tool
  only knows `assessments.audio_path` and would delete it). Every path goes through `services.recordings.absolute_path`.
  Audio is kept forever; only the admin `room_audio` purge tool (sets `audio_path=NULL, purged_at`, keeps transcripts)
  or an explicit `ROOM_MESSAGE_RETENTION_DAYS` removes it.
- Voice quota is per user **per UTC day**: `ROOMS_VOICE_QUOTA_MB` (default 200 MB) on `used_bytes(since=day start)`
  plus `ROOMS_VOICE_DAILY_PER_USER` (default 100 clips). Owner-confirmed default (SV-1); dropping `since=` in
  `VoiceService.upload` would make it a lifetime total. Separate from `recording_quota_mb`. The MB check through the insert runs under a per-sender lock
  (parallel uploads in several rooms cannot both pass). Learning summaries are also capped per room owner per day
  (`RoomLimits.summary_owner_daily`, scope `room_summary_owner`) before the global budget.
- A voice message hidden while its transcription/translation runs gets no `voice_update` (`_broadcast_voice`
  checks `hidden_at`). Switching a room to `approval` (owner or operator) clears `invite_token`.
- The web uses `camelcase-keys`, which rewrites object keys: reactions go on the wire as a `[{key, user_ids}]`
  list, never as an object keyed by reaction (R2-15). Same for any new map keyed by data.
- Private-lane messages go only to `audience_id`; replay queries must filter the same way.
- State that must survive a restart lives in the DB; the hub holds only connections. `VoiceService.resume()` marks
  in-flight transcriptions/translations failed after a restart.
- Owner-only events (`join_request`) are skipped for ownerless rooms (`owner_id` NULL after user deletion);
  `hub.broadcast(only_user=None)` would send them to everyone.
- Protocol changes need the matching web change (`protocol.test.ts` reads this package's file).
- Admin moderation (admin v2 §6, endpoints in `routers/admin_rooms.py`): messages are never deleted (R-6);
  `hide` only sets `hidden_at` — `message_out` then withholds text/meta/quote/voice/reactions (`hidden: true`),
  `recent_public` skips them, and `message_hidden{seq}` is broadcast. `rooms.ai_muted` makes `@ai` and the assistant
  answer `notice ai_off`. Admin playback is audited on every play (`room.audio.play`, ids only).
  Per-user caps (`rooms_max_owned`, `rooms_assist_daily_per_user`, `rooms_voice_*`) come from `core.quotas` via the router.
- `RoomsRuntime.reconfigure` (hub listener `rooms_runtime`) applies hot-reloaded limits; switching rooms off closes
  sockets with 4003, maintenance with 1012. `rt.voice` is always installed (translation keeps working when the voice
  switch is off); `ROOMS_VOICE_CONCURRENCY` is read once at startup.
