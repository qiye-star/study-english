# web/src/lib/

Pure, framework-light helpers shared by every layer.

## What lives here
- `storage.ts` (safe localStorage JSON, `PRACTICE_DRAFT_KEY`), `kv-cache.ts` (IndexedDB cache), `playback-rate.ts`.
- `abortable.ts`, `latency.ts` (timing marks, `window.__enjoyLatency`), `model-json.ts` (strict LLM JSON parsing), `cn.ts` (class merge aware of design tokens), `format-clock.ts`.
- `select-word.ts` — `selectWord(el)`: programmatic selection of an element's text so the global lookup bar appears (same contract as `features/library/word-tap.ts`; used by the wordbook review page's long-press).
- `speech-text.ts` — `speechText()`: strips CJK ideographs, kana and full-width runs before TTS (empty result = no TTS call). Applied once in `chat/tts.ts::speakableText`, which every read-aloud path uses; never bypass it.
- `hold-gesture.ts` — pure hold-to-talk gesture reducer (press/slide to cancel/to text) shared by chat and calls.
- `levels.ts` — CEFR display text (plan `2026-10-14-level-annotations`): `parseLevel` (accepts a trailing `+` for rank tiers), `levelName` / `levelLabel` (`B1 · 中级`) / `levelMeaning` (one-line meaning); `t` is passed in, strings are `web.level.*` in `components/i18n`. Display only: stored and sent values never change. Not the same as `features/chat/levels.ts::levelHint` (AI prompt text).
- `extension-points.ts` — typed extension-point registry (learning-links spec §8): `LINK_KEYS`, `LinkFlags`/`ALL_OFF`/`flagsFromConfig`, `PointProps`/`POINT_NAMES`, `contribute`/`contributeRoute`/`contributionsFor`/`routesFor`/`allRoutes`, link flags store. `extension-points-react.tsx` — `useLinkFlags`, `useContributions`, `<Slot>` (per-contribution error boundary), `<WordActions>`, `<LinkRoute>`. Points include `selectionActions` (`{ text, testId }`, the select-to-lookup action bar) and `practiceHeaderActions` (no props; header icon buttons left of the practice-list link; core contribution `changelog.entry`).

## Allowed dependencies
- npm packages and other `lib/` files only. Never `features/`, `pages/`, `layout/`, `auth/`, `settings/` (architecture test); avoid `api/` and `audio/` too.

## Test
- `cd web && yarn test` (`lib/*.test.ts`).

## Pitfalls
- Storage helpers must never throw (private mode, quota). Latency marks record timings only, never text.
- If a helper needs a feature, it belongs in that feature (or `auth/` for logout cleanup).
- The extension registry is a process singleton (contributions registered at import by `plugins/`); unit tests that need a clean one use `createExtensionRegistry()`. Flags start as `ALL_OFF` (identity = not loaded yet).
