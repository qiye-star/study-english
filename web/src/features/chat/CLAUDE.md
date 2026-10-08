# web/src/features/chat/

Conversations with the AI tutor: text and voice messages, hold-to-talk, auto-speak TTS, hints, recap, scenarios, levels, bilingual translation, per-turn assessment and grammar.

## What lives here
- Pages: `conversations-page.tsx`, `conversation-page.tsx` (orchestration; large).
- Turns: `use-voice-turn.ts`, `turn-results.ts` (assessment + grammar, late PATCH), `chat-request.ts`, `chat-turns.ts`, `ui-message.ts`.
- Speech out: `tts.ts`, `use-tts-player.ts` (sentence queue), `use-auto-speak.ts`, `sentence-stream.ts`, `sentences.ts`.
- Hold-to-talk: `hold-to-talk-button.tsx` wires voice messages to the shared gesture (`~/lib/hold-gesture` reducer, `~/components/use-hold-gesture`, `~/components/hold-to-talk-bar` UI, shared with realtime calls).
- Helpers: `hints*.ts(x)`, `recap*.ts(x)`, `scenarios.ts`, `levels.ts`, `coach.ts`, `composer-mode.ts`.
- `i18n/{en,zh-CN}.json` — this feature's strings.

## Public surface
Public (`index.ts`): pages, `useTtsPlayer`/`ttsErrorMessage`/`TtsState`, `useMessageTranslations`, logout cache clears. Other directories import only `~/features/chat`; add exports there only when another directory needs them.

## Allowed dependencies
- `lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via their `index.ts`. See `../CLAUDE.md`.

## Test
- `cd web && yarn vitest run src/features/chat`

## Pitfalls
- Every auto-speak reply costs a TTS call per sentence.
- iOS: prime the shared audio element synchronously in the tap (`primeAudioElement`).
- `sentence-stream.ts` must agree with `server/tests/fixtures/sentence_cases.json`.
- No playback while recording (`claimAudio` from `~/audio/audio-focus`).
