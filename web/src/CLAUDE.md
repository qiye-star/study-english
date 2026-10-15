# web/src/

Application source. Entry `main.tsx` (CSS, i18n init, color scheme, audio unlock, service worker) → `app.tsx` (providers + routes).

## Layers (enforced by `architecture.test.ts`)
- Low: `lib/` (pure helpers), `api/` (HTTP client + server contracts), `audio/` (capture/playback engines), `components/` (shared presentational UI). They never import `features/`, `pages/`, `layout/`, `auth/`, `settings/`.
- App state: `auth/` (session, logout cleanup), `settings/` (UI prefs), `i18n/`, `pwa/`, `styles/`.
- Features: `features/<name>/` with a public `index.ts`. Code outside a feature imports it only as `~/features/<name>`.
- Composition: `layout/` (shell, nav), `pages/` (non-feature screens), `app.tsx` (routes). Only `app.tsx`/`main.tsx` import `pages/`; pages do not use `audio/` directly.
- `plugins/`: extension-point composition layer (learning links); only `main.tsx` imports it (`test/setup.ts` may import `plugins/core`). Consumers render `<Slot point=…/>` / `<WordActions>` from `lib/extension-points-react`; providers register in `features/<x>/register*.ts(x)` (imported only by `plugins/`). See `plugins/CLAUDE.md`.
- `shims/`: the only place allowed to import `enjoy/src` via `@/…` or relative paths. `@renderer/*` alias imports are allowed anywhere.
- Liquid glass (plan `2026-10-15-liquid-glass`): `lib/glass-flag.ts` (`data-glass` attribute, `useLiquid`, route pins), `lib/glass-theme.ts` (pure theme model), `settings/glass-theme-store.ts` (device-local store); engine in `layout/glass-theme.ts`.
- `test/`: shared test helpers; `build/`: tests of the build config.

## Conventions
- Import with `~/…` across directories, `./…` within one. Tests sit next to code as `*.test.ts(x)`.
- UI strings go in the nearest `i18n/{en,zh-CN}.json`; they are merged automatically.

## Test
- `cd web && yarn test` (vitest, jsdom, setup `test/setup.ts`); architecture only: `yarn vitest run src/architecture.test.ts`.

## Pitfalls
- Barrel cycles between features are tolerated only because nothing uses a cross-feature import at module top level; keep it that way.
