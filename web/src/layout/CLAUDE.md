# web/src/layout/

App chrome around authenticated routes.

## What lives here
- `app-shell.tsx` — shell with `<Outlet>`, bottom nav, global `LookupLayer` and the shadow sheet (`ShadowSheetProvider` wraps the shell, `ShadowSheetHost` sits next to `LookupLayer`; `~/features/practice`).
- `bottom-nav.tsx` (练习 · 对话 · 联机 · 跟读库 · 我的; rooms and library tabs are controlled by `useRoomsEnabled()` / `useLibraryEnabled()`, at most 5 tabs), `page-header.tsx`.
- `page-header.tsx`: `large` = root-tab large title + capsule after 60px (liquid); actions/back render once.
- `glass-route-pin.tsx` — `GlassRoutePin` (in `AppShell`): `data-glass="pin"` on `/library*` and `/practice/changelog` so shared components keep the classic skin there (plan `2026-10-15-liquid-glass`). The shell paints `page-bg` (E0 background, liquid only).
- `use-app-height.ts` (`--app-height` + `scrollTo(0,0)` reset of the iOS-panned viewport after keyboard events, `KEYBOARD_SETTLE_MS`).
- `glass-theme.ts` — `initGlassTheme` (main.tsx, only when `data-glass` is set) / `applyGlassTheme`: writes the computed vars inline on `<html>`, `data-bg`, `.lite` (device memory or 减弱), and the `theme-color` metas via `setThemeColorOverride` (colour-scheme.ts; follows the chosen background on `data-glass="v2"` only).
- `color-scheme.ts` (`initColorScheme` applies the stored appearance preference to `html.dark` before first render and follows the system; `applyColorScheme`, `useApplyColorScheme`, `useIsDark`), `color-scheme-sync.tsx` (`ColorSchemeSync`, applies the "Me > Appearance" choice inside `SettingsProvider`), `glass-quality.ts` (`.lite` on low-memory devices).

## Allowed dependencies
- `components/`, `lib/`, `i18n/`, `settings/`, features via `~/features/<name>`. Not `pages/`.

## Test
- `cd web && yarn test` (`layout/*.test.ts(x)`).

## Pitfalls
- 5 tabs at 360 px are about 72 px each: tab labels stay at most 8 English characters / 4 Chinese characters (`bottom-nav.test.tsx` guards it); change a label together with that test.
- When the appearance is fixed to light/dark, both `theme-color` metas are rewritten to one colour (and restored for "follow system"); iOS home-screen status bar behaviour is not verified on a real device.
- Safe-area insets and app height matter on iOS standalone PWA; test with the mobile viewport.
- The bottom tab bar floats (plan `2026-10-14-floating-glass-bottom-bar`): anything that must clear it reads `var(--tab-bar-space)` (`index.css` `:root`: bar height + `--tab-bar-bottom` + 8px gap, safe area included). Never hard-code `3.5rem` or the safe area again; docks and composers inside `<main>` follow `<main>`'s padding automatically. The bar's real blur, contrast over posters and position above the iPhone home indicator are UNVERIFIED on devices.
- `html` / `body` are `position: fixed; overflow: hidden` in `index.css`: the document never scrolls, so every new page needs its own scroll container (`AppShell`'s `<main>`, the inner container of `AnnouncementFrame`, the wrapper of the full-maintenance page). Do not rely on `window.scrollTo` / document scrolling.
- The keyboard-jump fix (plan `2026-10-13-ios-keyboard-scroll`) is **not verified on a real iPhone**; read that plan's hypotheses and `…-device-checklist.md` before changing `use-app-height.ts`.
- The reset calls `scrollTo(0,0)` only when the offset is non-zero and the page is not pinch-zoomed; never read layout synchronously inside `visualViewport` handlers.
