# web/src/features/realtime/

Realtime voice calls over WebSocket `/api/realtime` (server ASR + LLM + TTS), with VAD or push-to-talk input.

## What lives here
- `realtime-call.ts` (session: ticket → mic → VAD → socket, teardown), `call-machine.ts` (pure state), `protocol.ts` (mirrors `server/app/realtime_protocol.py`).
- UI: `realtime-call-screen.tsx`, `call-hero.tsx`, `call-dock.tsx`, `call-captions.tsx`, `call-caption-translation.tsx`; hook `use-realtime-call.ts`.
- `realtime-api.ts` (config, ticket, URL), `errors.ts`.
- `i18n/{en,zh-CN}.json` — this feature's strings.

## Public surface
Public (`index.ts`): `fetchRealtimeConfig`, `RealtimeConfig`, `CallEnding`, `RealtimeEnv`, `RealtimeCallDialog`, `prepareCallAudio`. Other directories import only `~/features/realtime`; add exports there only when another directory needs them.

## Allowed dependencies
- `lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via their `index.ts`. See `../CLAUDE.md`.

## Test
- `cd web && yarn vitest run src/features/realtime`

## Pitfalls
- The ticket is a secret in the WS query string: never log it or include it in errors.
- `prepareCallAudio` must run synchronously in the tap (iOS).
- Every end path releases mic, VAD, player and own AudioContext; page hidden = hang up.
- `protocol.test.ts` reads the server file; change both sides together.
