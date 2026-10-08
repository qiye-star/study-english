# web/src/shims/

The only bridge from web code to `enjoy/src`.

## What lives here
- `enjoy-ui.ts` — slim `@renderer/components/ui` barrel (aliased in `vite.config.ts`/`tsconfig.json`).
- `enjoy-components.ts` — slim `@renderer/components` barrel (pronunciation result pieces).
- `enjoy-utils.ts` — `@renderer/lib/utils` with web's token-aware `cn`.
- `enjoy-sources.ts` — non-UI resources: `LANGUAGES`, desktop i18n JSON, command prompt sources (`?raw`).
- `empty-module.ts` — stubs for Electron-only packages.

## Rules
- Files elsewhere in `src/` must not import `@/…` or relative paths into `enjoy/` (architecture test). `@renderer/*` alias imports are allowed.
- Re-export only; no behaviour changes to upstream code.

## Test
- `cd web && yarn test` (`shims.test.tsx`).

## Pitfalls
- Never edit `enjoy/`. If an enjoy module drags in Electron or heavy deps, shim it here instead.
- Bare packages imported by reused enjoy files must be in `web/package.json` (`guard-enjoy-deps`).
