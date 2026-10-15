# web/src/pages/

Screens that are not owned by a single feature: `login-page.tsx`, `install-page.tsx`, `me-page.tsx` (profile, appearance, language, playback rate, grammar prompt editor, stats).

## Allowed dependencies
- Features only via `~/features/<name>`; `components/`, `layout/`, `auth/`, `settings/`, `api/`, `lib/`, `pwa/`, `i18n/`, `@renderer/*`.
- Not `audio/` (pages compose features). Only `app.tsx`/`main.tsx` import pages (architecture test).

## Entry points
- Routes in `src/app.tsx`. Strings in `pages/i18n/`.
- `appearance/` — 外观与主题 (`/me/appearance`, lazy from `app.tsx`; liquid only; plan `2026-10-15-liquid-glass` L3): sliders, presets, background picker, all through `useGlassTheme()`.

## Test
- `cd web && yarn test` (`pages/*.test.tsx`).

## Pitfalls
- New feature screens belong in `features/<name>/`, not here.
- Login form must never log credentials.
