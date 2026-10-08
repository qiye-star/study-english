# web/src/layout/

App chrome around authenticated routes.

## What lives here
- `app-shell.tsx` — shell with `<Outlet>`, bottom nav, global `LookupLayer`.
- `bottom-nav.tsx`, `page-header.tsx`, `use-app-height.ts`.
- `color-scheme.ts` (`initColorScheme`, `useIsDark`), `glass-quality.ts` (`.lite` on low-memory devices).

## Allowed dependencies
- `components/`, `lib/`, `i18n/`, `settings/`, features via `~/features/<name>`. Not `pages/`.

## Test
- `cd web && yarn test` (`layout/*.test.ts(x)`).

## Pitfalls
- Safe-area insets and app height matter on iOS standalone PWA; test with the mobile viewport.
