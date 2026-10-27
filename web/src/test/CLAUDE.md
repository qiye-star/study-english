# web/src/test/

Shared vitest helpers (not tests themselves, except `e2e-upstream-guard.test.ts`).

## What lives here
- `setup.ts` — jest-dom, i18n, observers, cleanup (vitest `setupFiles`).
- `render.tsx` — `renderWithProviders` (router, settings, auth with an injected `ApiClient`).
- `fetch-mock.ts` — route-table fetch mock; `fake-media.ts`, `fake-audio.ts` — fake mic/recorder/AudioContext; `hold.ts` — pointer-hold helpers; `tap-lookup.ts` — `TestPointerEvent`, `stubCaret`, `unstubCaret`, `tapAt` for tap-to-lookup tests.
- `fixtures/` — sample payloads (e.g. `assessment-good.json`).

## Allowed dependencies
- Anything in `src/`; never imported by production code.

## Test
- `cd web && yarn test`.

## Pitfalls
- Fakes prove logic, not device behaviour; do not claim iOS/Android results from them.
- Fixtures must not contain real tokens, user data or recordings.
