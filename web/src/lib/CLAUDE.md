# web/src/lib/

Pure, framework-light helpers shared by every layer.

## What lives here
- `storage.ts` (safe localStorage JSON, `PRACTICE_DRAFT_KEY`), `kv-cache.ts` (IndexedDB cache), `playback-rate.ts`.
- `glass-flag.ts` — liquid-glass attribute: `initGlassFlag` (main.tsx; always sets `data-glass="v2"` and removes the old `enjoy-web.dev.glass` key; no dev switch any more), `isLiquid` / `useLiquid` (structure branches), `isPinnedPath`, `setGlassPinned` (`"pin"` on library / changelog). Plan `2026-10-15-liquid-glass`.
- `glass-theme.ts` — pure liquid-glass model (plan `2026-10-15-liquid-glass`): `parseGlassTheme`, presets, `withPatch` / `withBg`, `computeGlassVars` (floors, lite caps), `guardBackground` (AA lightness clamp, ink side fixed per mode), `SWATCHES`. `tint` ranges 0.30..1.35 (slider 0..100). Below 0.55 the floors ramp from `FLOOR_MIN` (0.30) to the classic `FLOOR` (0.55), so presets and stored values >= 0.55 are unchanged; `a1` (card text) and dark `a2` (title contrast, Rev 4) are not lowered. Never relax `BASE` / `CEIL`, or the classic `FLOOR` values. `GLASS_DEFAULTS` is the 清透 (clear) preset (default since 2026-10-15; it spreads `GLASS_PRESETS.clear`, so edit the preset, not a second copy); stored themes keep their own values and preset name, a stored theme without a name parses as clear, `reset()` returns to clear. `styles/theme.css` keeps the 磨砂 numbers only as the pre-JS fallback (the writer overrides them at boot).
- `abortable.ts`, `latency.ts` (timing marks, `window.__enjoyLatency`), `model-json.ts` (strict LLM JSON parsing), `cn.ts` (class merge aware of design tokens), `format-clock.ts`.
- `select-word.ts` — `selectWord(el)`: programmatic selection of an element's text so the global lookup bar appears (same contract as `features/library/word-tap.ts`). `wordRangeAt(x, y, doc, within)`: the Range of the Latin word at a point (one text node, inside `within`), no selection change; `selectWordAt(x, y, doc, within)` selects it (a native selection wins). Used by tap-to-lookup.
- `lookup-context.ts` — lookup marks (`lookupContext`, `lookupContextIf`, `lookupTapOff`) and `lookupTapContext` (tap-to-lookup eligibility); features and plugins import only this file for lookup eligibility.
- `speech-text.ts` — `speechText()`: strips CJK ideographs, kana and full-width runs before TTS (empty result = no TTS call). Applied once in `chat/tts.ts::speakableText`, which every read-aloud path uses; never bypass it.
- `hold-gesture.ts` — pure hold-to-talk gesture reducer (press/slide to cancel/to text) shared by chat and calls.
- `levels.ts` — CEFR display text (plan `2026-10-14-level-annotations`): `parseLevel` (accepts a trailing `+` for rank tiers), `levelName` / `levelLabel` (`B1 · 中级`) / `levelMeaning` (one-line meaning); `t` is passed in, strings are `web.level.*` in `components/i18n`. Display only: stored and sent values never change. Not the same as `features/chat/levels.ts::levelHint` (AI prompt text).
- `extension-points.ts` — typed extension-point registry (learning-links spec §8): `LINK_KEYS`, `LinkFlags`/`ALL_OFF`/`flagsFromConfig`, `PointProps`/`POINT_NAMES`, `contribute`/`contributeRoute`/`contributionsFor`/`routesFor`/`allRoutes`, link flags store. Also the non-UI prompt-hint point (plan L4 Task 16): `contributePromptHint({ id, load(api, signal) })` and `collectPromptHints(api, timeoutMs = 300)` (parallel, each block cut to 300 characters, failures and timeouts count as nothing; the caller caches). `lib` imports `~/api/client` for the type only. `extension-points-react.tsx` — `useLinkFlags`, `useContributions`, `<Slot>` (per-contribution error boundary), `<WordActions>`, `<LinkRoute>`. Points include `selectionActions` (`{ text, testId }`, the select-to-lookup action bar) and `practiceHeaderActions` (no props; header icon buttons left of the practice-list link; core contribution `changelog.entry`).

## Allowed dependencies
- npm packages and other `lib/` files only. Never `features/`, `pages/`, `layout/`, `auth/`, `settings/` (architecture test); avoid `api/` and `audio/` too.

## Test
- `cd web && yarn test` (`lib/*.test.ts`).

## Pitfalls
- Storage helpers must never throw (private mode, quota). Latency marks record timings only, never text.
- If a helper needs a feature, it belongs in that feature (or `auth/` for logout cleanup).
- The extension registry is a process singleton (contributions registered at import by `plugins/`); unit tests that need a clean one use `createExtensionRegistry()`. Flags start as `ALL_OFF` (identity = not loaded yet).
