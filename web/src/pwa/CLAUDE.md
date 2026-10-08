# web/src/pwa/

PWA glue: `register-sw.ts` (registers `public/sw.js`) and `ios.ts` (when to show the iOS "Add to Home Screen" hint).

## Allowed dependencies
- Browser APIs only; no React feature code.

## Test
- `cd web && yarn test` (`pwa/*.test.ts`).

## Pitfalls
- The service worker caches only `/assets/*` and versioned `/vad/*`; API, audio and `index.html` stay network-only. Bump the cache name in `public/sw.js` when changing its rules.
