# web/src/pages/

Screens that are not owned by a single feature: `login-page.tsx`, `install-page.tsx`, `me-page.tsx` (profile, appearance, language, playback rate, grammar prompt editor, stats).

## Allowed dependencies
- Features only via `~/features/<name>`; `components/`, `layout/`, `auth/`, `settings/`, `api/`, `lib/`, `pwa/`, `i18n/`, `@renderer/*`.
- Not `audio/` (pages compose features). Only `app.tsx`/`main.tsx` import pages (architecture test).

## Entry points
- Routes in `src/app.tsx`. Strings in `pages/i18n/`.

## Test
- `cd web && yarn test` (`pages/*.test.tsx`).

## Pitfalls
- New feature screens belong in `features/<name>/`, not here.
- Login form must never log credentials.

## Liquid glass
- Liquid glass (plan 2026-10-15-liquid-glass L11): Me = profile hero (`me-hero`) + 外观与主题 row (`me-appearance`, liquid only, links to `/me/appearance`; the colour select stays for classic); login form is an E1 panel.
