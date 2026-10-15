# web/

Mobile-first PWA for practice: login, read-aloud assessment, AI chat (text, voice messages, hold-to-talk, realtime calls), lookup/translate, progress, vocabulary. Same-origin with `server/` in production.

## What lives here
- `src/` app code (see `src/CLAUDE.md`), `e2e/` Playwright specs, `scripts/` build helpers, `public/` static files + service worker.
- `vite.config.ts` aliases (`~/` → `src/`, `@/` and `@renderer/` → `enjoy/src/`, some barrels → `src/shims`), `guard-enjoy-deps` plugin, vitest config.
- `tsconfig.json` mirrors the aliases; `playwright.config.cts` (must stay CommonJS, see README).

## Allowed dependencies
- npm packages in `web/package.json`. Any bare import reached from `enjoy/src` must also be listed here, or the build fails (`guard-enjoy-deps`).
- `enjoy/src` read-only through `src/shims` / `@renderer/*`. Never import from `server/` except test fixtures that pin shared contracts.

## Commands (from repo root)
- `yarn web:dev` · `yarn web:typecheck` · `yarn web:test` · `yarn web:build` · `yarn web:e2e --project=chromium-mobile`
- Single test: `cd web && yarn vitest run src/path/file.test.ts`.

## Pitfalls
- Never edit `enjoy/`; add or extend a shim.
- `src/architecture.test.ts` enforces layering; fix the import, do not loosen the rule.
- iOS: audio must be unlocked inside a user gesture (`installAudioUnlock`, `primeAudioElement`, `prepareCallAudio`); `getUserMedia` in the gesture where possible.
- Realtime ticket is a secret in the WebSocket URL: never log it.
- `public/vad/` is generated and git-ignored; `scripts/copy-vad-assets.mjs` runs before dev/build.
- README.md documents behaviour and what is unverified on devices; keep it in sync with behaviour changes.
- Liquid glass (plan 2026-10-15-liquid-glass): append liquid: / LQ_* classes, never re-value tokens; Rule 4 (only titles and icons on blurred layers, other text on .plate); ≤ 3 resident blur layers + 1 transient (styles/glass-budget.test.ts); library/changelog routes are pinned to the classic skin.
