# web/src/pages/

Screens that are not owned by a single feature: `login-page.tsx`, `install-page.tsx`, `me-page.tsx` (profile, language, playback rate, grammar prompt editor, stats), `credits-page.tsx` (`/about/credits`: third-party data sources and full license texts; the embedded KyleBing BSD-3 text is checked against `server/dictionaries/kylebing-english-vocabulary/LICENSE` by its test).

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
