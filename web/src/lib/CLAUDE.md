# web/src/lib/

Pure, framework-light helpers shared by every layer.

## What lives here
- `storage.ts` (safe localStorage JSON, `PRACTICE_DRAFT_KEY`), `kv-cache.ts` (IndexedDB cache), `playback-rate.ts`.
- `abortable.ts`, `latency.ts` (timing marks, `window.__enjoyLatency`), `model-json.ts` (strict LLM JSON parsing), `cn.ts` (class merge aware of design tokens), `format-clock.ts`.
- `hold-gesture.ts` — pure hold-to-talk gesture reducer (press/slide to cancel/to text) shared by chat and calls.

## Allowed dependencies
- npm packages and other `lib/` files only. Never `features/`, `pages/`, `layout/`, `auth/`, `settings/` (architecture test); avoid `api/` and `audio/` too.

## Test
- `cd web && yarn test` (`lib/*.test.ts`).

## Pitfalls
- Storage helpers must never throw (private mode, quota). Latency marks record timings only, never text.
- If a helper needs a feature, it belongs in that feature (or `auth/` for logout cleanup).
