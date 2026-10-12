# web/src/lib/

Pure, framework-light helpers shared by every layer.

## What lives here
- `storage.ts` (safe localStorage JSON, `PRACTICE_DRAFT_KEY`), `kv-cache.ts` (IndexedDB cache), `playback-rate.ts`.
- `abortable.ts`, `latency.ts` (timing marks, `window.__enjoyLatency`), `model-json.ts` (strict LLM JSON parsing), `cn.ts` (class merge aware of design tokens), `format-clock.ts`.
- `speech-text.ts` — `speechText()`: strips CJK ideographs, kana and full-width runs before TTS (empty result = no TTS call). Applied once in `chat/tts.ts::speakableText`, which every read-aloud path uses; never bypass it.
- `hold-gesture.ts` — pure hold-to-talk gesture reducer (press/slide to cancel/to text) shared by chat and calls.
- `extension-points.ts` — typed extension-point registry (learning-links spec §8): `LINK_KEYS`, `LinkFlags`/`ALL_OFF`/`flagsFromConfig`, `PointProps`/`POINT_NAMES`, `contribute`/`contributeRoute`/`contributionsFor`/`routesFor`/`allRoutes`, link flags store. `extension-points-react.tsx` — `useLinkFlags`, `useContributions`, `<Slot>` (per-contribution error boundary), `<WordActions>`, `<LinkRoute>`.

## Allowed dependencies
- npm packages and other `lib/` files only. Never `features/`, `pages/`, `layout/`, `auth/`, `settings/` (architecture test); avoid `api/` and `audio/` too.

## Test
- `cd web && yarn test` (`lib/*.test.ts`).

## Pitfalls
- Storage helpers must never throw (private mode, quota). Latency marks record timings only, never text.
- If a helper needs a feature, it belongs in that feature (or `auth/` for logout cleanup).
- The extension registry is a process singleton (contributions registered at import by `plugins/`); unit tests that need a clean one use `createExtensionRegistry()`. Flags start as `ALL_OFF` (identity = not loaded yet).
