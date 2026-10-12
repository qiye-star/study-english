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
- `store.py` – all DB access for rooms/messages/members/join requests/invites/reactions (create/join/seq/replay/sweep/purge; `reopen` / `ended` / `ended_count` / `opened_anchor`; `mine` lists open rooms only)
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
  `SummaryRunner`: one capped LLM call per ended room, metered `rooms_summary` with no user; after a reopen the row is
  re-claimed when `created_at < opened_at`; `fail/skip` on a row that already has a summary restore `done` + `stale`)

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`. Never `rank`, `realtime`,
`admin` or `routers`. Endpoints and lifespan hooks: `app/routers/rooms.py`, `rooms_voice.py`, `rooms_summary.py`;
admin side in `app/admin/rooms_admin.py` + `app/routers/admin_rooms.py` (playback uses `audio.read_file`).

## Tests
`uv run pytest -q tests/test_rooms_*.py tests/test_admin_rooms_v2.py tests/test_admin_storage.py`
Contract fixtures (`CONTRACT_UPDATE=1` re-records): `tests/fixtures/rooms_contract.json`, `rooms_v2_core_contract.json`,
`rooms_v2_voice_contract.json`, `rooms_v2_summary_contract.json`; the web checks each key.

## Pitfalls
- Reopen (spec 2026-10-12): `reopen` runs inside the `_admission` lock, so a second parallel request gets `not_closed`; the expiry
  anchor is `opened_anchor(room)` (= `coalesce(opened_at, created_at)`, `opened_at` stays nullable for good, R-O1), never read
  `created_at` directly; an ended room has no WebSocket, so the `reopened` event usually has no receiver and the web polls
  `GET /api/rooms/{id}` (R-O3); a room closed by `admin` can only be reopened through `POST /api/admin/rooms/{id}/reopen`;
  reopening clears `invite_token` and draws a new code; logs and audit never carry the code or the room name.
- Summary rows never lose `data`: a failed regeneration puts the row back to `done` + `stale` (old summary readable), and `stale`
  can be retried within `summary_attempts` (R-O5). A reopen with no new public message since `opened_at` is NOT regenerated
  (old summary kept, no LLM call, no cap spend); a second close while the first run is still `pending` marks the row
  (`reason="rerun"`) and the finishing run regenerates once (process-local `take_rerun`).
- `sweep` closes with a conditional UPDATE (status open + same `reopen_count`/`opened_at`), so a close+reopen between the
  read and the write is never undone; it only reports rooms it really closed. Reopen needs an active owner membership on
  both paths (admin: `owner_gone`, 409; covers an owner who left and a retention-purged room). The admin reopen audit row is
  written right after the state change and before the announcement; announce/broadcast failures are logged (class only) and
  never turn a successful reopen into a 500 (owner and admin paths).
- Ruling R-O-ended (review finding 6): `ended` / `ended_count` stay unbounded in age on purpose (spec: all ended rooms the
  user is an active member of; messages are kept forever, and a purge removes the memberships so those rooms drop out).
- `RoomLimits.mine_closed_days` no longer affects any list (R-O4); only its default-value assertion remains.
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
- Room agents (`agent_lane.py`): a persona is its owner's text. `allow_private` / `memory` are on only when the asker's `share_in_rooms` / `memory_enabled` allow it AND the persona is built-in or owned by the asker AND the turn is not a hand-off; never rely on `ROOM_RULES` alone. A failed hand-off turn only refunds and restores the first answer's `ai_status` to `done` (no `ai_typing` / `ai_failed` for hand-offs, because `ai_failed.reply_to` would mark the delivered answer failed on clients).
- Addressing lane R (`AgentLane.route`, the only routing entry; `connection.on_say` just calls it): `@ai` / `@AI` / `@助手` = the room's default agent (first resolvable configured agent, else `builtin:coach`; a disabled first agent means `agent_off`, never the second) > `@name` > reply to an agent answer (`RoomStore.agent_of`; configured agents only, plus the coach when none is configured) > `say.to` (must be a configured agent). At most one turn per message; a running room tutor (`rooms.agent_tutor` set) closes reply/`to` routing, explicit `@` still works. Refused turns still publish the message: `agent_off` (feature off / disabled / `to` not in the room) before any room gate, then `ai_off` / `ai_busy` / `ai_quota` from `_reserve`; a refused reply is silent except for the `_reserve` notices. `meta.to_agent` is written only when `to` actually routed; `meta.note_zh` comes from `Done.note_zh`. The old public `@ai` answer lane (`_admit_ai` / `_answer`) is gone; `RoomConnection` without an agents handler only answers `notice agent_off` to `@ai` / `to`. `AgentRoute.via` (alias|name|reply|to|handoff) is for tests and `connection` only (logs carry nothing but codes).
- Room tutor (`agent_tutor.py`): stop / close cancel the in-flight `_turn` (`_cancel_turn`) and the turn re-checks run id + phase under the tutor lock before it appends; the question's timer is armed inside that same lock. Only ONLINE members are called on; with nobody online the lesson pauses with reason `empty` (no LLM call; `PAUSE_EMPTY` is a constant on purpose so web's source-scanning contract test does not need updating, the web shows the generic text for unknown reasons). Any exception in a turn pauses it (`state` for KeyError/TypeError/ValueError, else `upstream`), logging only the class name.
  Addressing lane T: the tutor speaks English; the starter's `zh_note` (`AgentPrefs.zh_note`) x the lesson's current level decide whether the prompt asks for the Chinese META fields (`note_zh` -> public `meta.note_zh` via `Done.note_zh`; `hint_zh` stays in the machine state and is the only optional extra key of the `agent_tutor` frame, no English hint key). `RoomTutor.on_message(room_id, message) -> bool` accepts text and transcribed voice (`kind` `voice`, `text` = transcript) from the called member only, and only when `message.seq > question_seq`; the tutor lock arbitrates a late transcript against the 60 s auto-skip (first wins, the loser returns `False`, no notice, no reset of the timer). `waits_for(room_id, user_id)` says whether the lesson is waiting for that member (used by the voice hook).
