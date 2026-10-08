# web/src/audio/

Browser audio engines: microphone capture, PCM/WAV encoding, VAD gates, call playback, audio focus. No UI.

## What lives here
- `capture.ts` (page `AudioContext`, `installAudioUnlock`, PCM vs MediaRecorder choice), `pcm-capture.worklet.js`, `pcm.ts`, `pcm-recording.ts`, `recorder.ts`, `use-recorder.ts`, `convert.ts`/`wav.ts`.
- Speech detection: `vad.ts` (Silero via `@ricky0123/vad-web`), `energy-vad.ts`, `energy-gate.ts`, `speech-gate.ts`.
- Realtime output: `pcm-player.ts` (24 kHz queue), `call-output.ts`, `audio-route.ts`.
- `audio-focus.ts` — one player at a time (`claimAudio`/`releaseAudio`), shared by chat and realtime.
- `describe-error.ts` + `i18n/` — user-facing mic/audio error messages.

## Allowed dependencies
- `lib/`, `api/error-messages`, npm packages, React hooks only for thin wrappers (`use-recorder.ts`). Never `features/`, `pages/`, `layout/`, `auth/`, `settings/`.

## Test
- `cd web && yarn test` (fakes in `test/fake-audio.ts`, `test/fake-media.ts`). Fakes prove logic only; device behaviour is unverified unless `docs/superpowers/plans/e2e-results.md` says so.

## Pitfalls
- iOS: the page `AudioContext` must be resumed inside a click/touchend; do not create extra contexts per recording; never close the shared context.
- Worklet files must not be inlined (`assetsInlineLimit` in `vite.config.ts`).
- Always release the microphone on every exit path (stop, error, unmount, page hidden).
- VAD assets come from `/vad/<versions>/`, never a CDN.
